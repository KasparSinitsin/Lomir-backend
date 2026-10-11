/**
 * The invented world of `npm run demo-db`: thirteen people, six teams in different states, roles in
 * every state, applications and invitations in every status, badge awards for all 30 badges, one
 * block. The chat and the notifications are in demoChat.js and derived from this data.
 *
 * Everything here is made up. Names, bios and messages are invented; every address is on
 * `example.com` (reserved for examples, RFC 2606); the places are real cities and districts, the
 * people in them are not.
 *
 * Tags and badges are named, not numbered: the seed looks the names up in
 * scripts/demo/reference/*.json, and test/demoData.test.js fails if a name is missing.
 */

const DEMO_PASSWORD = "LomirDemo2026"; // every demo account; hashed when the database is built, never stored

// Centre of the city and a central district, as the app would store them. Rounded coordinates.
const CITIES = {
  "Berlin": { postal: "10115", state: "Berlin", district: "Mitte", lat: 52.52, lon: 13.405 },
  "Leipzig": { postal: "04109", state: "Saxony", district: "Zentrum", lat: 51.3397, lon: 12.3731 },
  "Dresden": { postal: "01067", state: "Saxony", district: "Altstadt", lat: 51.0504, lon: 13.7373 },
  "München": { postal: "80331", state: "Bavaria", district: "Altstadt-Lehel", lat: 48.1351, lon: 11.582 },
  "Köln": { postal: "50667", state: "North Rhine-Westphalia", district: "Innenstadt", lat: 50.9375, lon: 6.9603 },
  "Frankfurt": { postal: "60311", state: "Hesse", district: "Innenstadt", lat: 50.1109, lon: 8.6821 },
  "Hannover": { postal: "30159", state: "Lower Saxony", district: "Mitte", lat: 52.3759, lon: 9.732 },
  "Hamburg": { postal: "20095", state: "Hamburg", district: "Hamburg-Mitte", lat: 53.5511, lon: 9.9937 },
};

// key, first, last, lang, city, bio, tags: [name, interest 1-3, experience 1-3]
// Optional: private (profile not public), hideBadges (the badge section is switched off),
// unverified (has not confirmed the e-mail address yet, so cannot log in).
const users = [
  { key: "mira", first: "Mira", last: "Okonkwo", lang: "en", city: "Berlin",
    bio: "Front-end developer who likes maps, plants and tidy pull requests.",
    tags: [["React", 3, 3], ["JavaScript", 3, 3], ["Gardening", 2, 2], ["Open Source", 3, 2]] },
  { key: "jonas", first: "Jonas", last: "Lindqvist", lang: "de", city: "Berlin",
    bio: "Backend-Entwickler, baut gern kleine Werkzeuge, die anderen Arbeit abnehmen.",
    tags: [["Node.js", 3, 3], ["Database Management", 2, 3], ["Open Source", 3, 3]] },
  { key: "selin", first: "Selin", last: "Aydin", lang: "en", city: "Berlin",
    bio: "UX researcher. Asks the second question and listens to the answer.",
    tags: [["UX Research", 3, 3], ["Accessibility (a11y) Design", 3, 2], ["Digital & UX Design", 2, 3]] },
  { key: "tomas", first: "Tomás", last: "Herrera", lang: "en", city: "Leipzig",
    bio: "Runs long distances slowly and plans routes carefully.",
    tags: [["Trail Running", 3, 3], ["Hiking", 3, 3], ["Open Water Swimming", 2, 1]] },
  { key: "leni", first: "Leni", last: "Hartmann", lang: "de", city: "Leipzig",
    bio: "Lauftreff-Organisatorin und Hobby-Fotografin.",
    tags: [["Trail Running", 3, 2], ["Photography", 3, 2], ["Nature Photography", 2, 2]] },
  { key: "pavel", first: "Pavel", last: "Novák", lang: "en", city: "Dresden", hideBadges: true,
    bio: "Climbs on weekends, writes data pipelines on weekdays. Keeps his badges to himself.",
    tags: [["Climbing & Bouldering", 3, 2], ["Data Engineering", 3, 3], ["Python", 3, 3]] },
  { key: "ines", first: "Inès", last: "Moreau", lang: "en", city: "München",
    bio: "Translator between French, German and English; poetry on the side.",
    tags: [["Translation", 3, 3], ["Poetry", 3, 2], ["German", 2, 3], ["English", 2, 3]] },
  { key: "felix", first: "Felix", last: "Brandt", lang: "de", city: "Köln", private: true,
    bio: "Mentor für Berufseinsteiger und leidenschaftlicher Hobby-Koch. Sein Profil ist privat.",
    tags: [["Mentoring", 3, 3], ["Home Cooking & Meal Prep", 3, 2], ["Teaching", 2, 3]] },
  { key: "yara", first: "Yara", last: "Haddad", lang: "en", city: "Frankfurt",
    bio: "Illustrator and podcast producer. Works remotely with people she has never met in person.",
    tags: [["Digital Illustration", 3, 3], ["Podcasting", 3, 2], ["Painting", 2, 2]] },
  { key: "noor", first: "Noor", last: "Verbeek", lang: "en", city: "Hannover",
    bio: "Sound editor. Happiest when a recording finally has no background hum.",
    tags: [["Podcast Editing", 3, 3], ["Acoustic Guitar", 2, 2], ["Theatre", 2, 1]] },
  { key: "matteo", first: "Matteo", last: "Conti", lang: "en", city: "Hamburg",
    bio: "Organises a neighbourhood kitchen where nobody eats alone.",
    tags: [["Volunteering & Community Service", 3, 3], ["Baking & Patisserie", 3, 2], ["Home Cooking & Meal Prep", 2, 3]] },
  { key: "hanna", first: "Hanna", last: "Sørensen", lang: "de", city: "Hamburg",
    bio: "Sozialpädagogin, kocht für viele und koordiniert Ehrenamtliche.",
    tags: [["Mentoring & Tutoring (Volunteering)", 3, 3], ["Sustainability & Eco Projects", 3, 2], ["Yoga", 2, 2]] },
  { key: "ravi", first: "Ravi", last: "Menon", lang: "en", city: "Köln", unverified: true,
    bio: "Signed up last week and has not confirmed the e-mail address yet.",
    tags: [["Python", 2, 1]] },
];

// Teams. `roles`: status open | filled (needs filledBy) | closed. `left`: people who were members and left.
// `archived`: the team was deleted and sits in the archive. ⚠️ The app's cleanup job removes an archived team
// 14 days after it was archived (ARCHIVED_TEAM_GRACE_DAYS), so this one disappears again from a demo
// database about two weeks after it was built.
const teams = [
  { key: "garden", name: "Open Source Garden Map", city: "Berlin", remote: false, max: 6,
    description: "We are building an open map of community gardens: where to find them, what grows there and when to come.",
    owner: "mira", admins: ["jonas"], members: ["selin"], left: [],
    tags: ["React", "Node.js", "Open Source", "Gardening"],
    roles: [
      { name: "Front-end developer", status: "open",
        bio: "Help us make the map fast on a phone. React, plain CSS, a love of small details.",
        tags: ["React", "JavaScript"], badges: ["Coder", "Team Player"] },
      { name: "Accessibility reviewer", status: "filled", filledBy: "selin",
        bio: "Check every new screen with a keyboard and a screen reader.",
        tags: ["Accessibility (a11y) Design"], badges: ["Detail-Oriented"] },
    ] },
  { key: "trail", name: "Trail Runners Leipzig", city: "Leipzig", remote: false, max: 12,
    description: "A relaxed running group: long trails on Sundays, swims in the lake when it is warm enough.",
    owner: "tomas", admins: [], members: ["leni"], left: [],
    tags: ["Trail Running", "Hiking", "Open Water Swimming"],
    roles: [
      { name: "Route planner", status: "open",
        bio: "Find and describe new routes of 15 to 25 km, with a note on where to refill water.",
        tags: ["Hiking"], badges: ["Organizer", "Reliable"] },
      { name: "Photographer", status: "closed",
        bio: "Take photos at the monthly run. We have found one, for now.",
        tags: ["Photography"], badges: ["Storyteller"] },
    ] },
  { key: "studio", name: "Pixel & Poetry Studio", city: "Frankfurt", remote: true, max: 8,
    description: "A remote studio for illustrated poems and a monthly podcast. Everyone works from where they are.",
    owner: "yara", admins: ["ines"], members: ["noor"], left: ["jonas"],
    tags: ["Digital Illustration", "Poetry", "Podcasting"],
    roles: [
      { name: "Podcast editor", status: "open",
        bio: "Cut, clean and mix one 30 minute episode a month.",
        tags: ["Podcast Editing"], badges: ["Detail-Oriented", "Reliable"] },
    ] },
  { key: "kitchen", name: "Community Kitchen Hamburg", city: "Hamburg", remote: false, max: 15,
    description: "We cook twice a week for whoever turns up and teach anyone who wants to learn.",
    owner: "matteo", admins: ["hanna"], members: ["felix"], left: [],
    tags: ["Home Cooking & Meal Prep", "Volunteering & Community Service", "Baking & Patisserie"],
    roles: [
      { name: "Volunteer coordinator", status: "open",
        bio: "Keep the rota full and the volunteers happy.",
        tags: ["Volunteering & Community Service"], badges: ["Organizer", "Empathetic"] },
    ] },
  { key: "reading", name: "Quiet Reading Circle", city: "München", remote: false, max: 8, isPublic: false,
    description: "A private circle that reads poems aloud once a month. Members only; the team is not listed.",
    owner: "ines", admins: [], members: ["leni"], left: [],
    tags: ["Poetry", "German"], roles: [] },
  { key: "mural", name: "Courtyard Mural Project", city: "Frankfurt", remote: false, max: 10, archived: true,
    description: "Painted the courtyard wall last summer. The team was deleted and sits in the archive.",
    owner: "yara", admins: [], members: ["noor"], left: [],
    tags: ["Painting", "Digital Illustration"], roles: [] },
];

// [applicant, team key, status, message, forOpenRole]
const applications = [
  ["pavel", "garden", "pending", "I build data pipelines for a living and would love to help with the garden data.", true],
  ["felix", "trail", "rejected", "I mostly walk, but I could bring snacks.", false],
  ["felix", "kitchen", "approved", "I cook for friends every week and would like to do it for more people.", false],
];

// [inviter, invitee, team key, status, message]
const invitations = [
  ["tomas", "pavel", "trail", "pending", "You climb, you will like the rocks on our Sunday route."],
  ["yara", "leni", "studio", "declined", "Would you take photos for the poems?"],
  ["matteo", "hanna", "kitchen", "accepted", "We need someone who can run the kitchen when I cannot."],
  ["mira", "noor", "garden", "canceled", "Would you record a short audio tour of the garden map?"],
];

// [blocker, blocked]
const blocks = [["leni", "felix"]];

// [to, by, badge, credits 1-3, context personal|team|project, team key or null, tag or null, reason, days ago, hidden]
// `hidden`: true leaves the award invisible to others until the recipient shows it (the pending state).
// Together they use every one of the 30 badges at least once.
const awards = [
  ["mira", "jonas", "Coder", 3, "team", "garden", "React", "Rebuilt the map component over a weekend and documented every step.", 12, false],
  ["mira", "selin", "Documentation Master", 2, "team", "garden", "Open Source", "The contributing guide finally answers the questions people actually ask.", 9, false],
  ["jonas", "mira", "Quick Learner", 2, "team", "garden", "Node.js", "Picked up our API in two days and fixed three bugs on the way.", 11, false],
  ["selin", "mira", "Detail-Oriented", 2, "team", "garden", "Accessibility (a11y) Design", "Found the contrast problem none of us had noticed.", 8, false],
  ["tomas", "leni", "Reliable", 3, "team", "trail", "Trail Running", "Has not missed a Sunday run in a year.", 20, false],
  ["leni", "tomas", "Organizer", 3, "team", "trail", "Trail Running", "Keeps the group list, the meeting points and the carpools in order.", 18, false],
  ["leni", "tomas", "Storyteller", 1, "personal", null, "Nature Photography", "Her photos made people sign up.", 6, false],
  ["yara", "ines", "Visionary", 3, "team", "studio", "Digital Illustration", "Saw the whole series in one sketch.", 15, false],
  ["ines", "yara", "Communicator", 2, "team", "studio", "Poetry", "Turns rough lines into something that can be read aloud.", 14, false],
  ["noor", "yara", "Detail-Oriented", 3, "team", "studio", "Podcast Editing", "Removed a hum we had lived with for months.", 5, false],
  ["matteo", "hanna", "Empathetic", 3, "team", "kitchen", "Volunteering & Community Service", "Notices who is new and sits down next to them.", 21, false],
  ["hanna", "matteo", "Delegator", 2, "team", "kitchen", "Mentoring & Tutoring (Volunteering)", "Gives people a job they can succeed at.", 16, false],
  ["felix", "hanna", "Mentor", 3, "personal", null, "Mentoring", "Spent his evenings helping two career changers prepare interviews.", 25, false],
  ["pavel", "mira", "Systems Thinker", 2, "project", null, "Data Engineering", "Drew the data flow on one page and it all made sense.", 4, false],
  ["ines", "felix", "Knowledge Sharer", 1, "personal", null, "Translation", "Shared her glossary with everybody.", 3, false],
  // The pending case: it also brings a focus area (Mentoring) Mira did not have, which stays invisible to others until she shows the award.
  ["mira", "felix", "Mentor", 2, "personal", null, "Mentoring", "Takes time to review first contributions kindly.", 1, true],
  ["jonas", "mira", "Team Player", 2, "team", "garden", "Node.js", "Always the first to answer a question in the channel.", 7, false],
  ["ines", "yara", "Mediator", 2, "team", "studio", "Translation", "Found the wording both sides could live with.", 13, false],
  ["tomas", "leni", "Motivator", 2, "team", "trail", "Hiking", "Gets people out of bed on rainy Sundays.", 17, false],
  ["selin", "jonas", "Designer", 2, "team", "garden", "Digital & UX Design", "The filter panel finally makes sense at first glance.", 6, false],
  ["pavel", "mira", "Data Whiz", 3, "project", null, "Python", "Cleaned a messy export into something we can query.", 10, false],
  ["noor", "yara", "Tech Support", 1, "team", "studio", null, "Fixed the shared drive before anyone noticed it was broken.", 19, false],
  ["yara", "noor", "Innovator", 3, "team", "studio", "Digital Illustration", "Combined hand drawing and generated textures in a way nobody had tried.", 22, false],
  ["mira", "jonas", "Problem Solver", 2, "team", "garden", "JavaScript", "Tracked a layout bug down to one missing style.", 5, false],
  ["matteo", "hanna", "Artisan", 2, "team", "kitchen", "Baking & Patisserie", "Her sourdough fed forty people twice.", 23, false],
  ["felix", "matteo", "Outside-the-Box", 1, "team", "kitchen", "Home Cooking & Meal Prep", "Turned leftovers into the best dish of the week.", 9, false],
  ["tomas", "leni", "Decision Maker", 2, "team", "trail", "Trail Running", "Called off the run when the forecast turned, and was right.", 14, false],
  ["hanna", "matteo", "Initiative Taker", 3, "team", "kitchen", "Sustainability & Eco Projects", "Started the compost corner on her own.", 26, false],
  ["mira", "selin", "Strategic Planner", 2, "team", "garden", "Open Source", "Mapped the next three releases on one page.", 8, false],
  ["noor", "ines", "Feedback Provider", 2, "team", "studio", "Podcast Editing", "Gives notes that are specific, kind and short.", 11, false],
  ["pavel", "selin", "Persistent", 1, "personal", null, "Climbing & Bouldering", "Kept at the same route for two months until it went.", 21, false],
  ["hanna", "felix", "Adaptable", 1, "personal", null, "Yoga", "Switched the whole workshop to the garden when it rained.", 2, false],
];

module.exports = { DEMO_PASSWORD, CITIES, users, teams, applications, invitations, blocks, awards };
