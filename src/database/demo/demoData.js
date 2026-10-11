/**
 * The invented world of `npm run seed:demo`: twelve people, four teams, some roles, badge
 * awards and a few chat messages. Everything here is made up. Names, bios and messages are
 * invented; every address is on `example.com` (reserved for examples, RFC 2606); the places
 * are real cities but the people in them are not.
 *
 * Tags and badges are named, not numbered: seedDemo.js looks the names up in
 * src/database/reference/*.json, and test/demoData.test.js fails if a name is missing.
 */

const DEMO_PASSWORD = "LomirDemo2026"; // every demo account; hashed when the seed runs, never stored

// key, first, last, language, city (see CITIES), bio, tags: [name, interest 1-3, experience 1-3]
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
  { key: "pavel", first: "Pavel", last: "Novák", lang: "en", city: "Dresden",
    bio: "Climbs on weekends, writes data pipelines on weekdays.",
    tags: [["Climbing & Bouldering", 3, 2], ["Data Engineering", 3, 3], ["Python", 3, 3]] },
  { key: "ines", first: "Inès", last: "Moreau", lang: "en", city: "München",
    bio: "Translator between French, German and English; poetry on the side.",
    tags: [["Translation", 3, 3], ["Poetry", 3, 2], ["German", 2, 3], ["English", 2, 3]] },
  { key: "felix", first: "Felix", last: "Brandt", lang: "de", city: "Köln",
    bio: "Mentor für Berufseinsteiger und leidenschaftlicher Hobby-Koch.",
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
];

// Centre of the city, as the app would store it. Real places, rounded coordinates.
const CITIES = {
  "Berlin": { postal: "10115", state: "Berlin", lat: 52.52, lon: 13.405 },
  "Leipzig": { postal: "04109", state: "Saxony", lat: 51.3397, lon: 12.3731 },
  "Dresden": { postal: "01067", state: "Saxony", lat: 51.0504, lon: 13.7373 },
  "München": { postal: "80331", state: "Bavaria", lat: 48.1351, lon: 11.582 },
  "Köln": { postal: "50667", state: "North Rhine-Westphalia", lat: 50.9375, lon: 6.9603 },
  "Frankfurt": { postal: "60311", state: "Hesse", lat: 50.1109, lon: 8.6821 },
  "Hannover": { postal: "30159", state: "Lower Saxony", lat: 52.3759, lon: 9.732 },
  "Hamburg": { postal: "20095", state: "Hamburg", lat: 53.5511, lon: 9.9937 },
};

// owner and members are user keys; members[0..] get role "admin" when listed in admins.
const teams = [
  { key: "garden", name: "Open Source Garden Map", city: "Berlin", remote: false, max: 6,
    description: "We are building an open map of community gardens: where to find them, what grows there and when to come.",
    owner: "mira", admins: ["jonas"], members: ["selin"],
    tags: ["React", "Node.js", "Open Source", "Gardening"],
    role: { name: "Front-end developer", bio: "Help us make the map fast on a phone. React, plain CSS, a love of small details.",
            tags: ["React", "JavaScript"], badges: ["Coder", "Team Player"] } },
  { key: "trail", name: "Trail Runners Leipzig", city: "Leipzig", remote: false, max: 12,
    description: "A relaxed running group: long trails on Sundays, swims in the lake when it is warm enough.",
    owner: "tomas", admins: [], members: ["leni"],
    tags: ["Trail Running", "Hiking", "Open Water Swimming"],
    role: { name: "Route planner", bio: "Find and describe new routes of 15 to 25 km, with a note on where to refill water.",
            tags: ["Hiking"], badges: ["Organizer", "Reliable"] } },
  { key: "studio", name: "Pixel & Poetry Studio", city: "Frankfurt", remote: true, max: 8,
    description: "A remote studio for illustrated poems and a monthly podcast. Everyone works from where they are.",
    owner: "yara", admins: ["ines"], members: ["noor"],
    tags: ["Digital Illustration", "Poetry", "Podcasting"],
    role: { name: "Podcast editor", bio: "Cut, clean and mix one 30 minute episode a month.",
            tags: ["Podcast Editing"], badges: ["Detail-Oriented", "Reliable"] } },
  { key: "kitchen", name: "Community Kitchen Hamburg", city: "Hamburg", remote: false, max: 15,
    description: "We cook twice a week for whoever turns up and teach anyone who wants to learn.",
    owner: "matteo", admins: ["hanna"], members: ["felix"],
    tags: ["Home Cooking & Meal Prep", "Volunteering & Community Service", "Baking & Patisserie"],
    role: { name: "Volunteer coordinator", bio: "Keep the rota full and the volunteers happy.",
            tags: ["Volunteering & Community Service"], badges: ["Organizer", "Empathetic"] } },
];

// [applicant, team key, status, message]
const applications = [
  ["pavel", "garden", "pending", "I build data pipelines for a living and would love to help with the garden data."],
  ["felix", "trail", "rejected", "I mostly walk, but I could bring snacks."],
];

// [inviter, invitee, team key, status, message]
const invitations = [
  ["tomas", "pavel", "trail", "pending", "You climb, you will like the rocks on our Sunday route."],
  ["yara", "leni", "studio", "declined", "Would you take photos for the poems?"],
];

// [to, by, badge, credits 1-3, context personal|team|project, team key or null, tag or null, reason, days ago, hidden]
// `hidden`: true leaves the award invisible to others until the recipient shows it (the pending state).
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
];

// [from, to, team key or null, text, minutes ago]; a team message has to = null and a team key
const messages = [
  ["mira", null, "garden", "Welcome Selin! The board is in the pinned message, start wherever you like.", 3000],
  ["selin", null, "garden", "Thanks! I will run a short usability session with the map on Thursday.", 2900],
  ["jonas", null, "garden", "I can have the API for the new filters ready by then.", 2850],
  ["mira", null, "garden", "Perfect. I will bring the new design for the garden cards.", 2800],
  ["tomas", null, "trail", "Sunday: 18 km, start at the lake at nine. Bring water.", 1500],
  ["leni", null, "trail", "I am in. Is the forest path still closed?", 1450],
  ["tomas", null, "trail", "Open again since Friday. Mud, though.", 1400],
  ["yara", null, "studio", "Episode 4 is recorded. Noor, the raw files are in the shared folder.", 700],
  ["noor", null, "studio", "Got them. First cut tomorrow evening.", 650],
  ["matteo", null, "kitchen", "Tuesday we cook for sixty. Who can come at four?", 400],
  ["hanna", null, "kitchen", "Me, and I will bring two volunteers from the school.", 380],
  ["mira", "jonas", null, "Do you have ten minutes to look at the filter endpoint?", 200],
  ["jonas", "mira", null, "Sure, call me after lunch.", 190],
  ["mira", "jonas", null, "Great, thank you!", 185],
  ["felix", "ines", null, "Could you look over my English cover letter? I can cook for you in return.", 90],
];

module.exports = { DEMO_PASSWORD, CITIES, users, teams, applications, invitations, awards, messages };
