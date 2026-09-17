/**
 * The failure codes the search endpoints can answer with.
 *
 * Same shape and rules as `config/contactErrors.js` — read its header first:
 * `code` is stable and never shown, `values` carries only what the backend
 * alone knows, `message` stays so an old frontend keeps working and no deploy
 * order arises, and every payload key is camelCase.
 *
 * `values.operator` is always "AND", "OR" or "NOT", also when the user typed
 * `-` or lowercase: the tokenizer normalises operators, and operators are
 * syntax that stays English in every UI language (plan decision E1).
 */

const SEARCH_ERROR_CODES = {
  QUERY_TOO_SHORT: "QUERY_TOO_SHORT",
  QUERY_EMPTY: "QUERY_EMPTY",
  UNCLOSED_QUOTE: "UNCLOSED_QUOTE",
  STARTS_WITH_OPERATOR: "STARTS_WITH_OPERATOR",
  ENDS_WITH_OPERATOR: "ENDS_WITH_OPERATOR",
  NOT_WITHOUT_TERM: "NOT_WITHOUT_TERM",
  OPERATOR_WITHOUT_TERMS: "OPERATOR_WITHOUT_TERMS",
  SEARCH_FAILED: "SEARCH_FAILED",
};

module.exports = { SEARCH_ERROR_CODES };
