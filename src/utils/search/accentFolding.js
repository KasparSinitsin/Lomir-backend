// Accent-insensitive text search (STATUS item 52). `Kunstler` finds `Künstler`,
// `Andre` finds `André`; what is shown stays as stored. Pure SQL building, so
// every search site calls ONE function and a new language is one entry below.
//
// Needs the PostgreSQL extension `unaccent` (migration create_unaccent_extension):
// it must exist before code that calls this runs, or every search fails.
//
// 🔴 Two kinds of forms, on purpose:
//  1. the BASE form is language neutral: lower case, accents taken off
//     (ü→u, é→e, ø→o, ß→ss ...). It always applies.
//  2. a language's ALTERNATIVE SPELLING is an EXTRA form that also matches:
//     `Mueller` finds `Müller`. It is never a replacement of the base form,
//     because in other languages the same letters are separate letters
//     (Swedish and Finnish å ä ö, Danish æ ø å, Turkish ı): turning them into
//     "ae/oe/ue" for everybody would merge different words.
// A search term matches when ANY form of the text contains the same form of
// the term; the forms are never mixed.

// Per language: the letters that are written out in another language-specific way.
// Letters only (checked in the tests): the values are put into SQL as literals.
const ALTERNATIVE_SPELLINGS = Object.freeze({
  de: Object.freeze([
    ["ä", "ae"],
    ["ö", "oe"],
    ["ü", "ue"],
    ["ß", "ss"],
  ]),
});

// lower case, the language's letters written out, then the accents off.
const foldSql = (expression, spellings = []) =>
  `unaccent(${spellings.reduce(
    (inner, [letter, written]) => `replace(${inner}, '${letter}', '${written}')`,
    `lower(${expression})`,
  )})`;

// The SQL boolean "haystack contains the pattern" in any form, the replacement
// for `haystack ILIKE pattern`. `pattern` is an ILIKE pattern as before (the
// caller adds the % signs). `haystackSql` and `patternSql` are SQL expressions;
// the pattern appears once per form, so a template that is substituted with a
// single replace must use replaceAll.
const accentInsensitiveLike = (haystackSql, patternSql) => {
  const forms = [[], ...Object.values(ALTERNATIVE_SPELLINGS)];
  return `(${forms
    .map((spellings) => `${foldSql(haystackSql, spellings)} LIKE ${foldSql(patternSql, spellings)}`)
    .join(" OR ")})`;
};

module.exports = { ALTERNATIVE_SPELLINGS, foldSql, accentInsensitiveLike };
