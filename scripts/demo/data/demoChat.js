/**
 * The free-text part of the demo chat: what the invented people write to each other.
 * Nothing here is real. The system messages (role events, who joined, who left, who was accepted)
 * and the notifications are not listed here: seedChat.js and seedNotifications.js derive them from
 * demoData.js, in the formats the app itself writes.
 *
 * Fields: key (so a later message can answer it), from, team (a team chat) or to (a direct message),
 * text (`{@key}` becomes a mention), ago (minutes ago), replyTo (the key of the message answered),
 * edited, deleted (the text is removed, as the app does), readBy (team: who has read it) or
 * read (direct message: has the receiver read it).
 */
const messages = [
  // Open Source Garden Map
  { key: "g1", from: "mira", team: "garden", text: "Welcome {@selin}! The board is in the pinned message, start wherever you like.", ago: 3000, readBy: ["selin", "jonas"] },
  { key: "g2", from: "selin", team: "garden", text: "Thanks! I will run a short usability session with the map on Thursday.", ago: 2900, replyTo: "g1", readBy: ["mira", "jonas"] },
  { key: "g3", from: "jonas", team: "garden", text: "I can have the API for the new filters ready by then.", ago: 2850, edited: true, readBy: ["mira"] },
  { key: "g4", from: "mira", team: "garden", text: "Perfect. I will bring the new design for the garden cards.", ago: 2800, readBy: [] },
  { key: "g5", from: "jonas", team: "garden", deleted: true, ago: 2700, readBy: [] },
  // Trail Runners Leipzig
  { key: "t1", from: "tomas", team: "trail", text: "Sunday: 18 km, start at the lake at nine. Bring water.", ago: 1500, readBy: ["leni"] },
  { key: "t2", from: "leni", team: "trail", text: "Ich bin dabei. Ist der Waldweg noch gesperrt?", ago: 1450, replyTo: "t1", readBy: ["tomas"] },
  { key: "t3", from: "tomas", team: "trail", text: "Open again since Friday. Mud, though.", ago: 1400, readBy: [] },
  // Pixel & Poetry Studio
  { key: "s1", from: "yara", team: "studio", text: "Episode 4 is recorded. {@noor}, the raw files are in the shared folder.", ago: 700, readBy: ["noor", "ines"] },
  { key: "s2", from: "noor", team: "studio", text: "Got them. First cut tomorrow evening.", ago: 650, readBy: ["yara"] },
  // Community Kitchen Hamburg
  { key: "k1", from: "matteo", team: "kitchen", text: "Tuesday we cook for sixty. Who can come at four?", ago: 400, readBy: ["hanna", "felix"] },
  { key: "k2", from: "hanna", team: "kitchen", text: "Ich komme und bringe zwei Ehrenamtliche aus der Schule mit.", ago: 380, readBy: ["matteo"] },
  // Quiet Reading Circle (private) and Courtyard Mural Project (archived)
  { key: "r1", from: "ines", team: "reading", text: "Next time: the poems of the first chapter, read aloud, no comments until the end.", ago: 900, readBy: ["leni"] },
  { key: "m1", from: "yara", team: "mural", text: "The wall is finished. Thank you all, this was the best summer project.", ago: 4000, readBy: ["noor"] },
  { key: "m2", from: "noor", team: "mural", text: "Photos are in the folder. I will keep the team archived for now.", ago: 3900, readBy: ["yara"] },

  // Direct messages
  { from: "mira", to: "jonas", text: "Do you have ten minutes to look at the filter endpoint?", ago: 200, read: true },
  { from: "jonas", to: "mira", text: "Sure, call me after lunch.", ago: 190, read: true },
  { from: "mira", to: "jonas", text: "Great, thank you!", ago: 185, read: true },
  { from: "felix", to: "ines", text: "Could you look over my English cover letter? I can cook for you in return.", ago: 90, read: false },
  { from: "matteo", to: "hanna", text: "Can you take the Tuesday shift again?", ago: 60, read: false },
];

module.exports = { messages };
