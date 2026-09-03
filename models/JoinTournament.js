const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const JoinTournamentSchema = new mongoose.Schema({
  participantId: {
    type: String,
    default: () => "PRT" + uuidv4().substring(0, 6).toUpperCase(),
    unique: true
  },

  userID: { type: String, required: false, default: "test-user" },
  tournamentID: { type: String, required: false, default: "test-tournament" },

  freeFireUsername: { type: String, default: null },

  // Authoritative Free Fire ID — always copied server-side from the
  // logged-in user's saved User.freefireId at join time. Never trust
  // a client-supplied value here.
  freefireId: { type: String, default: null },

  playerName: { type: String, default: null },
  userName: { type: String, default: null },
  email: { type: String, default: null },

  seats: { type: [Number], default: [] },
  fee: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("JoinTournament", JoinTournamentSchema);