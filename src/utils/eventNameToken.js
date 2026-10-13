/**
 * Builds the `id:name` token the chat's event parser reads
 * (`parseIdNameToken` in the frontend's `messageSystemParser.js`).
 *
 * Why the prose events need it: five stored formats (👋 joined, 🎯 assigned /
 * accepted, 🎉 applied successfully) named a person by NAME ONLY, so the name
 * was frozen at write time. A rename never reached those banners, and a
 * deletion could only be handled by rewriting stored rows. With an id in the
 * token the frontend resolves the current name at display time, the same way
 * it already does for @-mentions.
 *
 * 🔴 The failure mode is deliberate: anything that is not a positive integer
 * id degrades to the BARE NAME, which is exactly today's behaviour. That
 * matters because the parser's token pattern is `^(\d+)\s*:(.+)$` — a
 * non-numeric id would not match it, and the whole `"abc:Anna Kowalski"`
 * string would be shown to readers as the person's name. Never emit a token
 * we cannot prove the parser will split.
 *
 * ⚠️ Known and NOT introduced here: a stored legacy name that itself begins
 * with digits and a colon ("2:1 win") is split by that pattern. No human name
 * has that shape, and the risk exists for rows written long before this.
 */
const idNameToken = (id, name) => {
  const safeName = typeof name === "string" ? name.trim() : "";
  if (!safeName) return "";

  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) return safeName;

  return `${numeric}:${safeName}`;
};

module.exports = { idNameToken };
