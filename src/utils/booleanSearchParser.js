/**
 * Boolean Search Query Parser
 *
 * Supports:
 * - AND operator (default between terms, or explicit "AND")
 * - OR operator
 * - NOT operator (or "-" prefix)
 * - Quoted phrases for exact matching
 *
 * Examples:
 * - "web development" → exact phrase search
 * - react AND node → must contain both
 * - react OR vue → must contain either
 * - react NOT angular → must contain react, must not contain angular
 * - react -angular → same as above
 * - "full stack" OR backend → phrase OR single term
 */

const OPERATORS = {
  AND: "AND",
  OR: "OR",
  NOT: "NOT",
};

/**
 * Tokenize the search query into terms, phrases, and operators
 * @param {string} query - Raw search query
 * @returns {Array} Array of tokens
 */
function tokenize(query) {
  const tokens = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < query.length) {
    const char = query[i];

    // Handle quotes
    if (char === '"' || char === "'") {
      if (inQuotes) {
        // End of quoted phrase
        if (current.trim()) {
          tokens.push({ type: "PHRASE", value: current.trim() });
        }
        current = "";
        inQuotes = false;
      } else {
        // Start of quoted phrase - save any current term first
        if (current.trim()) {
          tokens.push(classifyToken(current.trim()));
        }
        current = "";
        inQuotes = true;
      }
      i++;
      continue;
    }

    // If in quotes, just accumulate
    if (inQuotes) {
      current += char;
      i++;
      continue;
    }

    // Handle spaces (term separators)
    if (char === " ") {
      if (current.trim()) {
        tokens.push(classifyToken(current.trim()));
      }
      current = "";
      i++;
      continue;
    }

    // Handle NOT prefix (-)
    if (char === "-" && current === "") {
      tokens.push({ type: "OPERATOR", value: OPERATORS.NOT });
      i++;
      continue;
    }

    current += char;
    i++;
  }

  // Don't forget the last token
  if (current.trim()) {
    if (inQuotes) {
      tokens.push({ type: "PHRASE", value: current.trim() });
    } else {
      tokens.push(classifyToken(current.trim()));
    }
  }

  return tokens;
}

/**
 * Classify a token as operator or term
 * @param {string} token - Token string
 * @returns {Object} Token object with type and value
 */
function classifyToken(token) {
  const upper = token.toUpperCase();
  if (upper === "AND" || upper === "&&") {
    return { type: "OPERATOR", value: OPERATORS.AND };
  }
  if (upper === "OR" || upper === "||") {
    return { type: "OPERATOR", value: OPERATORS.OR };
  }
  if (upper === "NOT" || upper === "!") {
    return { type: "OPERATOR", value: OPERATORS.NOT };
  }
  return { type: "TERM", value: token };
}

/**
 * Parse tokens into a structured query tree
 * @param {Array} tokens - Array of tokens
 * @returns {Array} Parsed query structure
 */
function parseTokens(tokens) {
  const conditions = [];
  let currentOperator = OPERATORS.AND; // Default operator
  let negateNext = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === "OPERATOR") {
      if (token.value === OPERATORS.NOT) {
        negateNext = true;
      } else {
        currentOperator = token.value;
      }
      continue;
    }

    // It's a TERM or PHRASE
    conditions.push({
      term: token.value,
      isPhrase: token.type === "PHRASE",
      negated: negateNext,
      operator: conditions.length > 0 ? currentOperator : null,
    });

    // Reset state
    negateNext = false;
    currentOperator = OPERATORS.AND; // Reset to default
  }

  return conditions;
}

/**
 * Build PostgreSQL WHERE clause conditions from parsed query
 *
 * @param {Array} conditions - Parsed conditions
 * @param {Array} columns - Column names to search in
 * @param {number} startParamIndex - Starting parameter index for $1, $2, etc.
 * @param {Object|null} tagConfig - Optional config for handling tag columns with EXISTS/NOT EXISTS
 *   - tagColumn: string (e.g. 'tag.name' or 't.name')
 *   - existsTemplate: SQL template with $PARAM placeholder
 *   - notExistsTemplate: SQL template with $PARAM placeholder
 *   - extraExistsTemplates: array of SQL templates with $PARAM placeholder
 *   - extraNotExistsTemplates: array of SQL templates with $PARAM placeholder
 *
 * @returns {Object} { whereClause: string, params: array, nextParamIndex: number }
 */
function buildSQLConditions(
  conditions,
  columns,
  startParamIndex = 1,
  tagConfig = null,
) {
  if (conditions.length === 0) {
    return { whereClause: "TRUE", params: [], nextParamIndex: startParamIndex };
  }

  const params = [];
  let paramIndex = startParamIndex;
  const sqlParts = [];

  const hasTagConfig =
    tagConfig && typeof tagConfig.tagColumn === "string" && tagConfig.tagColumn;

  for (const condition of conditions) {
    const { term, isPhrase, negated, operator } = condition;

    const pattern = `%${term}%`; // phrase vs term currently same behavior

    // Split columns into regular vs tag column
    const tagColumn = hasTagConfig ? tagConfig.tagColumn : null;
    const hasTagColumn =
      !!tagColumn && Array.isArray(columns) && columns.includes(tagColumn);

    const regularColumns = hasTagColumn
      ? columns.filter((col) => col !== tagColumn)
      : columns.slice();

    const regularMatch =
      regularColumns.length > 0
        ? `(${regularColumns
            .map((col) => `COALESCE(${col}, '') ILIKE $${paramIndex}`)
            .join(" OR ")})`
        : "";

    // Tag match + extras match
    let tagMatch = "";
    let extraMatch = "";

    if (hasTagColumn && tagConfig) {
      // Main tag exists / not-exists
      if (!negated && tagConfig.existsTemplate) {
        tagMatch = tagConfig.existsTemplate.replace("$PARAM", `$${paramIndex}`);
      } else if (negated && tagConfig.notExistsTemplate) {
        tagMatch = tagConfig.notExistsTemplate.replace(
          "$PARAM",
          `$${paramIndex}`,
        );
      } else {
        // Fallback to joined-column matching if templates missing
        tagMatch = `(${tagColumn} ILIKE $${paramIndex})`;
        if (negated) tagMatch = `NOT ${tagMatch}`;
      }

      // Extras (e.g. badge-name exists)
      const extras = !negated
        ? tagConfig.extraExistsTemplates || []
        : tagConfig.extraNotExistsTemplates || [];

      if (extras.length > 0) {
        const replaced = extras.map((tpl) =>
          tpl.replace("$PARAM", `$${paramIndex}`),
        );

        // positive extras => OR, negative extras => AND
        extraMatch = negated
          ? `(${replaced.join(" AND ")})`
          : `(${replaced.join(" OR ")})`;
      }
    }

    // Combine into a clause for this term
    let sql = "";

    if (!negated) {
      const positives = [regularMatch, tagMatch, extraMatch].filter(Boolean);

      if (positives.length === 0) {
        sql = "TRUE";
      } else if (positives.length === 1) {
        sql = positives[0].startsWith("(") ? positives[0] : `(${positives[0]})`;
      } else {
        sql = `(${positives.join(" OR ")})`;
      }
    } else {
      const negatives = [];

      if (regularMatch) negatives.push(`(NOT ${regularMatch})`);
      if (tagMatch) negatives.push(tagMatch); // already negated if template used
      if (extraMatch) negatives.push(extraMatch); // already AND-grouped for negated

      if (negatives.length === 0) {
        sql = "TRUE";
      } else if (negatives.length === 1) {
        sql = `(${negatives[0]})`;
      } else {
        sql = `(${negatives.join(" AND ")})`;
      }
    }

    params.push(pattern);

    if (sqlParts.length > 0 && operator) {
      sqlParts.push(operator);
    }
    sqlParts.push(sql);

    paramIndex++;
  }

  const whereClause = buildGroupedClause(sqlParts);

  return {
    whereClause: `(${whereClause})`,
    params,
    nextParamIndex: paramIndex,
  };
}

/**
 * Build grouped clause respecting operator precedence (AND before OR)
 * NOTE: currently this is a simple join and does not truly implement precedence.
 */
function buildGroupedClause(parts) {
  let result = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === OPERATORS.AND || part === OPERATORS.OR) {
      result += ` ${part} `;
    } else {
      result += part;
    }
  }

  return result || "TRUE";
}

/**
 * Main function: Parse a boolean search query and generate SQL conditions
 */
function parseBooleanSearch(
  query,
  columns,
  startParamIndex = 1,
  tagConfig = null,
) {
  if (!query || !query.trim()) {
    return {
      whereClause: "TRUE",
      params: [],
      nextParamIndex: startParamIndex,
      parsedConditions: [],
    };
  }

  const tokens = tokenize(query);
  const conditions = parseTokens(tokens);
  const result = buildSQLConditions(
    conditions,
    columns,
    startParamIndex,
    tagConfig,
  );

  return {
    ...result,
    parsedConditions: conditions,
  };
}

/**
 * Check if a query contains boolean operators
 */
function hasBooleanOperators(query) {
  if (!query || !query.trim()) return false;

  const tokens = tokenize(query);

  if (tokens.some((t) => t.type === "OPERATOR")) return true;
  if (tokens.some((t) => t.type === "PHRASE")) return true;

  return false;
}

function validateBooleanQuery(query) {
  const tokens = tokenize(query);

  if (!tokens.length) {
    return { valid: false, message: "Search query is empty." };
  }

  // quick mismatched quotes check
  const doubleQuotes = (query.match(/"/g) || []).length;
  const singleQuotes = (query.match(/'/g) || []).length;
  if (doubleQuotes % 2 !== 0 || singleQuotes % 2 !== 0) {
    return { valid: false, message: "Unclosed quote in search query." };
  }

  const isOp = (t) => t.type === "OPERATOR";
  const isTerm = (t) => t.type === "TERM" || t.type === "PHRASE";

  // Cannot start with AND/OR
  if (
    isOp(tokens[0]) &&
    (tokens[0].value === OPERATORS.AND || tokens[0].value === OPERATORS.OR)
  ) {
    return {
      valid: false,
      message: `Query cannot start with "${tokens[0].value}".`,
    };
  }

  // Cannot end with any operator
  if (isOp(tokens[tokens.length - 1])) {
    return {
      valid: false,
      message: `Query cannot end with "${tokens[tokens.length - 1].value}".`,
    };
  }

  // adjacency rules
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : null;
    const next = i < tokens.length - 1 ? tokens[i + 1] : null;

    if (isOp(t)) {
      if (t.value === OPERATORS.NOT) {
        if (!next || !isTerm(next)) {
          return {
            valid: false,
            message: `NOT must be followed by a search term.`,
          };
        }
      } else {
        if (!prev || !isTerm(prev) || !next || !isTerm(next)) {
          return {
            valid: false,
            message: `${t.value} must be between two search terms.`,
          };
        }
      }
    }
  }

  return { valid: true, message: "" };
}

module.exports = {
  parseBooleanSearch,
  hasBooleanOperators,
  tokenize,
  parseTokens,
  validateBooleanQuery,
  OPERATORS,
};
