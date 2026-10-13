const { users, blocks, CITIES } = require("../data/demoData");
const {
  CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_AGE_CONFIRMATION_VERSION,
} = require("../../../src/config/legalDocuments");
const { DAY, TS, TSTZ, TSTZN, tagId } = require("./seedContext");

// People, their focus areas, and who blocks whom.
async function seedPeople(ctx, { passwordHash }) {
  const { client } = ctx;

  for (const [index, user] of users.entries()) {
    const city = CITIES[user.city];
    const { rows } = await client.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, bio,
                          postal_code, latitude, longitude, city, state, district, country,
                          is_public, email_verified, is_synthetic, preferred_language, hide_badges,
                          accepted_terms_at, accepted_privacy_at, confirmed_age_16_at,
                          accepted_terms_version, accepted_privacy_version, confirmed_age_16_version,
                          verification_token, verification_token_expires, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DE',$13,$14,true,$15,$16,
               ${TSTZ(17)},${TSTZ(17)},${TSTZ(17)},$18,$19,$20,$21,${TSTZN(22)},${TS(23)},${TS(23)})
       RETURNING id`,
      [
        `demo_${user.key}`, `demo.${user.key}@example.com`, passwordHash, user.first, user.last, user.bio,
        city.postal, city.lat, city.lon, user.city, city.state, city.district,
        !user.private, !user.unverified, user.lang, Boolean(user.hideBadges),
        (40 + index) * DAY,
        CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_AGE_CONFIRMATION_VERSION,
        // The e-mail link of an account that has not confirmed yet. A fixed word, valid for a week:
        // enough to try the confirmation page on a demo database.
        user.unverified ? "demo-confirmation-token" : null,
        user.unverified ? -7 * DAY : null,
        (40 + index) * DAY,
      ],
    );
    ctx.userId[user.key] = rows[0].id;
    ctx.bump("users");

    for (const [name, interest, experience] of user.tags) {
      await client.query(
        `INSERT INTO user_tags (user_id, tag_id, interest_level, experience_level, source)
         VALUES ($1, $2, $3, $4, 'user')`,
        [ctx.userId[user.key], tagId(name), interest, experience],
      );
      ctx.bump("user_tags");
    }
  }

  for (const [blocker, blocked] of blocks) {
    await client.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, ${TSTZ(3)})`,
      [ctx.userId[blocker], ctx.userId[blocked], 5 * DAY],
    );
    ctx.bump("user_blocks");
  }
}

module.exports = { seedPeople };
