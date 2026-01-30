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
 * @returns {Object} Parsed query structure
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
 * @param {Array} conditions - Parsed conditions
 * @param {Array} columns - Column names to search in
 * @param {number} startParamIndex - Starting parameter index for $1, $2, etc.
 * @returns {Object} { whereClause: string, params: array, nextParamIndex: number }
 */
/**
 * Build PostgreSQL WHERE clause conditions from parsed query
 * @param {Array} conditions - Parsed conditions
 * @param {Array} columns - Column names to search in
 * @param {number} startParamIndex - Starting parameter index for $1, $2, etc.
 * @param {Object} tagConfig - Optional config for handling tag columns with EXISTS/NOT EXISTS
 *   - tagColumn: the column name for tags (e.g., 'tag.name' or 't.name')
 *   - existsTemplate: SQL template for EXISTS subquery with $PARAM placeholder
 *   - notExistsTemplate: SQL template for NOT EXISTS subquery with $PARAM placeholder
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

    const pattern = isPhrase ? `%${term}%` : `%${term}%`;

    // Split columns into regular vs tag column
    const tagColumn = hasTagConfig ? tagConfig.tagColumn : null;
    const hasTagColumn = tagColumn ? columns.includes(tagColumn) : false;

    const regularColumns = hasTagColumn
      ? columns.filter((col) => col !== tagColumn)
      : columns.slice();

    // Build regular columns condition
    // NOTE: for negated, we still build the positive match then wrap with NOT
    const regularMatch =
      regularColumns.length > 0
        ? `(${regularColumns
            .map((col) => `COALESCE(${col}, '') ILIKE $${paramIndex}`)
            .join(" OR ")})`
        : "";

    // Build tag condition using EXISTS/NOT EXISTS templates when available
    let tagMatch = "";
    if (hasTagColumn) {
      if (!negated && tagConfig.existsTemplate) {
        tagMatch = tagConfig.existsTemplate.replace("$PARAM", `$${paramIndex}`);
      } else if (negated && tagConfig.notExistsTemplate) {
        tagMatch = tagConfig.notExistsTemplate.replace(
          "$PARAM",
          `$${paramIndex}`,
        );
      } else {
        // Fallback (not ideal) to joined-column matching if templates missing
        // This keeps behavior stable, but won't fix multi-tag AND unless existsTemplate is provided.
        tagMatch = `(${tagColumn} ILIKE $${paramIndex})`;
        if (negated) tagMatch = `NOT ${tagMatch}`;
      }
    }

    // Combine regular + tag conditions
    // Positive: (regularMatch OR tagMatch)
    // Negative: (NOT regularMatch) AND (NOT EXISTS tagMatch)  [already built via templates]
    let sql = "";

    if (!negated) {
      if (regularMatch && tagMatch) {
        sql = `(${regularMatch} OR ${tagMatch})`;
      } else if (regularMatch) {
        sql = regularMatch;
      } else if (tagMatch) {
        sql = `(${tagMatch})`;
      } else {
        sql = "TRUE";
      }
    } else {
      // negated
      const notRegular = regularMatch ? `(NOT ${regularMatch})` : "";
      if (notRegular && tagMatch) {
        // tagMatch is already NOT EXISTS(...) if template provided
        sql = `(${notRegular} AND ${tagMatch})`;
      } else if (notRegular) {
        sql = notRegular;
      } else if (tagMatch) {
        sql = `(${tagMatch})`;
      } else {
        sql = "TRUE";
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
 * Main function: Parse a boolean search query and generate SQL conditions
 * @param {string} query - Raw search query string
 * @param {Array} columns - Column names to search in
 * @param {number} startParamIndex - Starting parameter index
 * @param {Object} tagConfig - Optional config for NOT EXISTS handling of tags
 * @returns {Object} { whereClause, params, nextParamIndex, parsedConditions }
 */

/**
 * Build grouped clause respecting operator precedence (AND before OR)
 * @param {Array} parts - SQL parts with operators
 * @returns {string} Grouped SQL clause
 */
function buildGroupedClause(parts) {
  // Simple approach: join with operators as they appear
  // For proper precedence, we'd need a more complex parser
  let result = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "AND" || part === "OR") {
      result += ` ${part} `;
    } else {
      result += part;
    }
  }

  return result || "TRUE";
}

/**
 * Main function: Parse a boolean search query and generate SQL conditions
 * @param {string} query - Raw search query string
 * @param {Array} columns - Column names to search in
 * @param {number} startParamIndex - Starting parameter index
 * @returns {Object} { whereClause, params, nextParamIndex, parsedConditions }
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
 * @param {string} query - Search query
 * @returns {boolean} True if query contains boolean operators
 */
function hasBooleanOperators(query) {
  if (!query || !query.trim()) return false;

  const tokens = tokenize(query);

  // If any boolean operator token exists, it's a boolean query
  if (tokens.some((t) => t.type === "OPERATOR")) return true;

  // If any phrase token exists, treat it as boolean-capable query
  // (because phrases need special parsing)
  if (tokens.some((t) => t.type === "PHRASE")) return true;

  return false;
}


function validateBooleanQuery(query) {
  const tokens = tokenize(query);

  if (!tokens.length) {
    return { valid: false, message: "Search query is empty." };
  }

  // If quotes are unmatched, tokenize() will treat remaining text as a PHRASE,
  // but we still want to flag obvious mismatched quotes early.
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

  // Check adjacency rules
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : null;
    const next = i < tokens.length - 1 ? tokens[i + 1] : null;

    if (isOp(t)) {
      // NOT must be followed by a term/phrase (NOT NOT ok? You can choose; currently disallow)
      if (t.value === OPERATORS.NOT) {
        if (!next || !isTerm(next)) {
          return {
            valid: false,
            message: `NOT must be followed by a search term.`,
          };
        }
      } else {
        // AND/OR must have term on both sides
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
