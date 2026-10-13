// A focus area is findable by its stored English name AND by any translation
// of it (tag_translations, any language: a German "Wandern" finds "Hiking" in
// an English interface too, as with the badge names).
//
// `param` appears ONCE in every fragment: the boolean parser substitutes its
// `$PARAM` placeholder with `String.replace`, which replaces the first
// occurrence only, and a second one would reach postgres as text.

// True when the tag in `tagAlias` has a label that matches `param` (ILIKE).
const tagNameMatchSQL = (tagAlias, param) => `EXISTS (
                  SELECT 1
                  FROM (
                    SELECT ${tagAlias}.name AS label
                    UNION ALL
                    SELECT trn.name
                    FROM tag_translations trn
                    WHERE trn.tag_id = ${tagAlias}.id
                  ) AS cand(label)
                  WHERE cand.label ILIKE ${param}
                )`;

// A lateral join giving every tag its best match rank for the search term
// `param` (a plain term, not a pattern): 1 exact, 2 prefix, 3 contains, over
// the name and all translations. Rows without a match are dropped by
// `WHERE ${alias}.relevance IS NOT NULL`. `param` may be repeated here: these
// routes use real parameters, not the boolean parser.
const tagRelevanceJoinSQL = (tagAlias, param, joinAlias = "tm") => `
      LEFT JOIN LATERAL (
        SELECT MIN(CASE
                 WHEN LOWER(l.label) = LOWER(${param}) THEN 1
                 WHEN LOWER(l.label) LIKE LOWER(${param}) || '%' THEN 2
                 ELSE 3
               END) AS relevance
        FROM (
          SELECT ${tagAlias}.name AS label
          UNION ALL
          SELECT trn.name
          FROM tag_translations trn
          WHERE trn.tag_id = ${tagAlias}.id
        ) AS l
        WHERE LOWER(l.label) LIKE '%' || LOWER(${param}) || '%'
      ) ${joinAlias} ON TRUE`;

module.exports = { tagNameMatchSQL, tagRelevanceJoinSQL };
