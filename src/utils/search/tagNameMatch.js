// A focus area is findable by its stored English name AND by any translation
// of it (tag_translations, any language: a German "Wandern" finds "Hiking" in
// an English interface too, as with the badge names).
//
// Matching ignores accents (STATUS item 52, accentFolding.js): `Kunstler` finds
// "Künstler". `param` may appear several times in a fragment: the boolean
// parser replaces its `$PARAM` placeholder everywhere.

const { accentInsensitiveLike, accentInsensitiveEquals } = require("./accentFolding");

// True when the tag in `tagAlias` has a label that matches `param` (an ILIKE
// pattern, accent-insensitive).
const tagNameMatchSQL = (tagAlias, param) => `EXISTS (
                  SELECT 1
                  FROM (
                    SELECT ${tagAlias}.name AS label
                    UNION ALL
                    SELECT trn.name
                    FROM tag_translations trn
                    WHERE trn.tag_id = ${tagAlias}.id
                  ) AS cand(label)
                  WHERE ${accentInsensitiveLike("cand.label", param)}
                )`;

// A lateral join giving every tag its best match rank for the search term
// `param` (a plain term, not a pattern): 1 exact, 2 prefix, 3 contains, over
// the name and all translations, ignoring accents. Rows without a match are
// dropped by `WHERE ${alias}.relevance IS NOT NULL`. `param` may be repeated
// here: these routes use real parameters, not the boolean parser.
const tagRelevanceJoinSQL = (tagAlias, param, joinAlias = "tm") => `
      LEFT JOIN LATERAL (
        SELECT MIN(CASE
                 WHEN ${accentInsensitiveEquals("l.label", param)} THEN 1
                 WHEN ${accentInsensitiveLike("l.label", `${param}::text || '%'`)} THEN 2
                 ELSE 3
               END) AS relevance
        FROM (
          SELECT ${tagAlias}.name AS label
          UNION ALL
          SELECT trn.name
          FROM tag_translations trn
          WHERE trn.tag_id = ${tagAlias}.id
        ) AS l
        WHERE ${accentInsensitiveLike("l.label", `'%' || ${param}::text || '%'`)}
      ) ${joinAlias} ON TRUE`;

module.exports = { tagNameMatchSQL, tagRelevanceJoinSQL };
