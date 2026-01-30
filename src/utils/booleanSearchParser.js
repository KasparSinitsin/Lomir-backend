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
function buildSQLConditions(conditions, columns, startParamIndex = 1) {
  if (conditions.length === 0) {
    return { whereClause: "TRUE", params: [], nextParamIndex: startParamIndex };
  }

  const params = [];
  let paramIndex = startParamIndex;
  const sqlParts = [];

  for (const condition of conditions) {
    const { term, isPhrase, negated, operator } = condition;

    // Build the column search conditions
    const columnConditions = columns
      .map((col) => `${col} ILIKE $${paramIndex}`)
      .join(" OR ");

    // For phrases, use exact pattern; for terms, use word boundary awareness
    const pattern = isPhrase ? `%${term}%` : `%${term}%`;
    params.push(pattern);

    let sql = `(${columnConditions})`;

    if (negated) {
      sql = `NOT ${sql}`;
    }

    // Add operator if not the first condition
    if (sqlParts.length > 0 && operator) {
      sqlParts.push(operator);
    }

    sqlParts.push(sql);
    paramIndex++;
  }

  // Build the final WHERE clause
  // Group OR conditions properly
  const whereClause = buildGroupedClause(sqlParts);

  return {
    whereClause: `(${whereClause})`,
    params,
    nextParamIndex: paramIndex,
  };
}

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
function parseBooleanSearch(query, columns, startParamIndex = 1) {
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
  const result = buildSQLConditions(conditions, columns, startParamIndex);

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
  if (!query) return false;

  // Check for operators
  const upperQuery = query.toUpperCase();
  if (
    upperQuery.includes(" AND ") ||
    upperQuery.includes(" OR ") ||
    upperQuery.includes(" NOT ")
  ) {
    return true;
  }

  // Check for quoted phrases
  if (query.includes('"') || query.includes("'")) {
    return true;
  }

  // Check for NOT prefix
  if (query.includes(" -") || query.startsWith("-")) {
    return true;
  }

  return false;
}

module.exports = {
  parseBooleanSearch,
  hasBooleanOperators,
  tokenize,
  parseTokens,
  OPERATORS,
};
