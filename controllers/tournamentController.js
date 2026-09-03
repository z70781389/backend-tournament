const Tournament      = require("../models/Tournament");
const JoinTournament  = require("../models/JoinTournament");
const TournamentResult = require("../models/tournamentResult");
const User            = require("../models/User");
const mongoose        = require("mongoose");
const AuditLog        = require("../models/AuditLog");
const Transaction     = require("../models/Transaction");
const notif = require("../services/notificationService");
const BlockedFreeFireId = require("../models/BlockedFreeFireId");

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function shouldGiveStar(level, rank) {
  if (level >= 1 && level <= 3) return rank <= 12;
  if (level >= 4 && level <= 6) return rank <= 8;
  if (level >= 7 && level <= 8) return rank <= 5;
  if (level >= 9 && level <= 20) return rank <= 3;
  return false;
}

function getCategory(level) {
  const categories = [
    "Bronze", "Silver I", "Silver II", "Silver III",
    "Gold I", "Gold II", "Gold III", "Gold IV", "Gold V",
    "Platinum I", "Platinum II", "Platinum III", "Platinum IV", "Platinum V", "Platinum VI",
    "Diamond I", "Diamond II", "Diamond III", "Diamond IV", "Diamond V",
    "Heroic", "Elite Heroic", "Master", "Elite Master",
    "Grand Master I", "Grand Master II", "Grand Master III", "Grand Master IV", "Grand Master V",
    "Biggest Grand Master"
  ];
  if (level < 1) return "Bronze";
  if (level > categories.length) return "Legend";
  return categories[level - 1];
}

// ----------------------------------------------------------------
// Create Tournament
// ----------------------------------------------------------------
exports.createTournament = async (req, res) => {
  console.log("➡️ Create Tournament API called", req.body);

  try {
    const {
      name, description,
      category, type, subType,
      tournamentType,
      joinPassword,
      joinCode,
      entryFee, prizePool, maxPlayers,
      date, time, image, perKillRate
    } = req.body;

    if (!name || !category || !type || !maxPlayers || !date || !time) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const tType = (tournamentType || "PAID").toUpperCase();

    if (tType === "FREE") {
      if (!joinPassword || joinPassword.trim() === "") {
        return res.status(400).json({
          message: "Join password is required for FREE tournaments"
        });
      }
    }

    if (joinCode && joinCode.trim() !== "") {
      const codeExists = await Tournament.findOne({ joinCode: joinCode.trim() });
      if (codeExists) {
        return res.status(400).json({
          message: "Join code already exists. Use a unique code."
        });
      }
    }

    let validatedImage = null;
    if (image && image.trim() !== "") {
      if (!isValidUrl(image.trim())) {
        return res.status(400).json({
          message: "Invalid image URL. Must be a valid http/https URL."
        });
      }
      validatedImage = image.trim();
    }

    const newTournament = new Tournament({
      name,
      description: description ? description.trim() : null,
      category,
      type,
      subType:        subType || "NONE",
      tournamentType: tType,
      joinPassword:   tType === "FREE" ? joinPassword.trim() : null,
      joinCode: (tType === "FREE" && joinCode && joinCode.trim() !== "")
        ? joinCode.trim()
        : null,
      entryFee:    tType === "FREE" ? 0 : (Number(entryFee) || 0),
      prizePool:   Number(prizePool)   || 0,
      maxPlayers:  Number(maxPlayers),
      date,
      time,
      image:       validatedImage,
      perKillRate: Number(perKillRate) || 0,
    });

    const saved = await newTournament.save();
    console.log("✅ TOURNAMENT SAVED:", saved);

    notif.notifyNewTournament(saved).catch(err =>
      console.error("[NOTIF] createTournament:", err.message)
    );

    res.status(201).json({
      message: "Tournament created successfully",
      tournament: saved,
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// ----------------------------------------------------------------
// Get All Tournaments
// ----------------------------------------------------------------
exports.getAllTournaments = async (req, res) => {
  try {
    const tournaments = await Tournament.find().sort({ createdAt: -1 });

    const results = await TournamentResult.find({}, { tournamentId: 1 });
    const submittedIds = new Set(results.map(r => r.tournamentId.toString()));

    const tournamentsWithFlag = tournaments.map(t => {
      const obj = t.toObject();
      obj.isResultSubmitted = submittedIds.has(t._id.toString());
      return obj;
    });

    res.status(200).json({ success: true, data: tournamentsWithFlag });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// ----------------------------------------------------------------
// Get Participants
// ----------------------------------------------------------------
exports.getParticipants = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Tournament ID is required" });
    }

    const participants = await JoinTournament.find({ tournamentID: id });

    return res.status(200).json({
      success: true,
      data: participants.map(p => ({
        _id:              p._id,
        userID:           p.userID,
        participantId:    p.participantId,
        freeFireUsername: p.freeFireUsername || "",
        freefireId:       p.freefireId        || "",
        playerName:       p.playerName       || "",
        userName:         p.userName         || "",
        email:            p.email            || "",
        seats:            p.seats            || [],
        fee:              p.fee              || 0,
        joinedAt:         p.joinedAt
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

// ----------------------------------------------------------------
// Verify Join Password
// ----------------------------------------------------------------
exports.verifyJoinPassword = async (req, res) => {
  try {
    const { id }           = req.params;
    const { joinPassword } = req.body;

    if (!joinPassword || joinPassword.trim() === "") {
      return res.status(400).json({ success: false, message: "Password Required" });
    }

    const tournament = await Tournament.findById(id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    if (tournament.tournamentType !== "FREE") {
      return res.status(400).json({ success: false, message: "This is not a free tournament" });
    }

    if (tournament.joinPassword !== joinPassword.trim()) {
      return res.status(400).json({ success: false, message: "Incorrect Password" });
    }

    return res.status(200).json({ success: true, message: "Password verified successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------
// Join Tournament
// ----------------------------------------------------------------
exports.joinTournament = async (req, res) => {
  console.log("➡️ Join Tournament API called", req.body);

  const userId = req.user._id.toString();

  const { fee, playerName, freeFireUsername, seats, tournamentId } = req.body;

  if (!freeFireUsername || !seats || seats.length === 0) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }
  if (!tournamentId) {
    return res.status(400).json({ success: false, message: "Tournament ID missing" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user       = await User.findById(userId).session(session);
    const tournament = await Tournament.findById(tournamentId).session(session);

    if (!user || !tournament) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ success: false, message: "User or Tournament not found" });
    }

    // Blocked account cannot join
    if (user.isBlocked) {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked by the administrator.",
      });
    }

    // Always use account's saved Free Fire ID — never client input
    const accountFreefireId = user.freefireId;

    const blockedId = await BlockedFreeFireId.findOne({
      freefireId: accountFreefireId,
      active: true,
    }).session(session);

    if (blockedId) {
      await session.abortTransaction(); session.endSession();

      await AuditLog.create([{
        userId,
        action:     "BLOCKED_FREEFIREID_JOIN_ATTEMPT",
        targetId:   tournamentId,
        targetType: "Tournament",
        meta: {
          freefireId: accountFreefireId,
          blockReason: blockedId.reason,
        },
        ip:     req.ip,
        status: "blocked",
      }]);

      return res.status(403).json({
        success: false,
        message: "This Free Fire ID is not allowed to participate in tournaments.",
      });
    }

    const alreadyJoined = await JoinTournament.findOne({
      userID: userId, tournamentID: tournamentId
    }).session(session);

    if (alreadyJoined) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, message: "Already joined this tournament" });
    }

    const usernameTaken = await JoinTournament.findOne({
      tournamentID:     tournamentId,
      freeFireUsername: freeFireUsername.trim(),
    }).session(session);

    if (usernameTaken) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({
        success: false,
        message: "This Free Fire username is already used in this tournament",
      });
    }

    const takenSeats     = tournament.joinedUsers.map(u => u.seatNumber);
    const requestedSeats = seats.map(s => Number(s));
    const conflict       = requestedSeats.some(s => takenSeats.includes(s));

    if (conflict) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, message: "Selected seat is already taken" });
    }

    const isFree    = tournament.tournamentType === "FREE";
    const actualFee = isFree ? 0 : tournament.entryFee * seats.length;

    if (!isFree) {
      const totalBalance = (user.deposit || 0) + (user.winning || 0) + (user.bonus || 0);
      if (totalBalance < actualFee) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, message: "Insufficient balance" });
      }

      let remaining = actualFee;
      if (user.bonus >= remaining) {
        user.bonus -= remaining; remaining = 0;
      } else {
        remaining -= user.bonus; user.bonus = 0;
      }
      if (remaining > 0) {
        if (user.winning >= remaining) {
          user.winning -= remaining; remaining = 0;
        } else {
          remaining -= user.winning; user.winning = 0;
        }
      }
      if (remaining > 0) { user.deposit -= remaining; }
      await user.save({ session });
    }

    const join = new JoinTournament({
      userID:           userId,
      tournamentID:     tournamentId,
      freeFireUsername: freeFireUsername.trim(),
      freefireId:       accountFreefireId,
      playerName:       playerName ? playerName.trim() : freeFireUsername.trim(),
      userName:         user.username,
      email:            user.email,
      seats:            requestedSeats,
      fee:              actualFee,
      joinedAt:         new Date(),
    });
    await join.save({ session });

    await User.findByIdAndUpdate(
      userId,
      { $inc: { totalMatches: 1 } },
      { session }
    );

    requestedSeats.forEach(seatNumber => {
      tournament.joinedUsers.push({ userId, seatNumber });
    });
    tournament.joinedPlayers = tournament.joinedUsers.length;

    const half = Math.floor(tournament.maxPlayers / 2);
    if (!tournament.notifHalfSlots && tournament.joinedPlayers >= half) {
      tournament.notifHalfSlots = true;
      notif.notifyHalfSlots(tournament).catch(err =>
        console.error("[NOTIF] halfSlots:", err.message)
      );
    }

    const slotsLeft = tournament.maxPlayers - tournament.joinedPlayers;
    if (!tournament.notifLastSlots && slotsLeft <= 3 && slotsLeft > 0) {
      tournament.notifLastSlots = true;
      notif.notifyLastSlots(tournament).catch(err =>
        console.error("[NOTIF] lastSlots:", err.message)
      );
    }

    await tournament.save({ session });

    await AuditLog.create([{
      userId:     userId,
      action:     "TOURNAMENT_JOIN",
      amount:     actualFee,
      targetId:   tournamentId,
      targetType: "Tournament",
      meta: {
        seats:            requestedSeats,
        freeFireUsername: freeFireUsername.trim(),
        freefireId:       accountFreefireId,
        isFree,
      },
      ip:     req.ip,
      status: "success",
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Joined successfully",
      data: {
        participantId:    join.participantId,
        freefireId:       accountFreefireId,
        remainingBalance: user.deposit + user.winning + user.bonus,
        lockedSeats:      requestedSeats,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log("JOIN ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------
// Start Tournament
// ----------------------------------------------------------------
exports.startTournament = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "Tournament ID is required" });

    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ success: false, message: "Tournament not found" });

    if (tournament.status !== "upcoming") {
      return res.status(400).json({
        success: false,
        message: `Cannot start. Current status: ${tournament.status}`
      });
    }

    tournament.status = "ongoing";
    await tournament.save();

    return res.status(200).json({ success: true, message: "Tournament started", data: tournament });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------
// End Tournament
// ----------------------------------------------------------------
exports.endTournament = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "Tournament ID is required" });

    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ success: false, message: "Tournament not found" });

    if (tournament.status !== "ongoing") {
      return res.status(400).json({
        success: false,
        message: `Cannot end. Current status: ${tournament.status}`
      });
    }

    tournament.status = "completed";
    await tournament.save();

    return res.status(200).json({ success: true, message: "Tournament ended", data: tournament });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------
// Cancel Tournament
// ----------------------------------------------------------------
exports.cancelTournament = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "Tournament ID is required" });

    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ success: false, message: "Tournament not found" });

    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel. Status: ${tournament.status}`
      });
    }

    tournament.status = "cancelled";
    await tournament.save();

    return res.status(200).json({ success: true, message: "Tournament cancelled", data: tournament });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------
// Submit Result
// ----------------------------------------------------------------
exports.submitResult = async (req, res) => {
  try {
    const { id }      = req.params;
    const { winners } = req.body;

    if (!id) return res.status(400).json({ success: false, message: "Tournament ID required" });
    if (!winners || !Array.isArray(winners) || winners.length === 0) {
      return res.status(400).json({ success: false, message: "Winners list required" });
    }

    if (!req.user || !req.user.isAdmin) {
      await AuditLog.create({
        userId:     req.user?._id || null,
        action:     "RESULT_SUBMIT",
        targetId:   id,
        targetType: "Tournament",
        status:     "blocked",
        meta:       { reason: "Non-admin attempt" },
        ip:         req.ip,
      });
      return res.status(403).json({ success: false, message: "Only admin can submit results" });
    }

    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ success: false, message: "Tournament not found" });

    const existingResult = await TournamentResult.findOne({ tournamentId: id });
    if (existingResult) {
      return res.status(400).json({ success: false, message: "Result already submitted for this tournament" });
    }

    const participants       = await JoinTournament.find({ tournamentID: id });
    const participantUserIds = participants.map(p => p.userID.toString());

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      if (!w.position || w.position < 1) {
        return res.status(400).json({ success: false, message: `Winner at index ${i}: invalid position` });
      }
      if (!w.userId || w.userId.toString().trim() === "") {
        return res.status(400).json({ success: false, message: `Winner at position ${w.position}: userId missing` });
      }
      if (!w.username || w.username.toString().trim() === "") {
        return res.status(400).json({ success: false, message: `Winner at position ${w.position}: username missing` });
      }
      if (!participantUserIds.includes(w.userId.toString().trim())) {
        return res.status(400).json({
          success: false,
          message: `Winner at position ${w.position} (${w.username}) did not participate in this tournament`,
        });
      }
      if (w.prize === undefined || w.prize === null) w.prize = 0;
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      for (const w of winners) {
        const prize = Number(w.prize) || 0;
        const uid   = w.userId.toString().trim();
        const pos   = Number(w.position);

        let winnerUser = await User.findById(uid).session(session).catch(() => null);
        if (!winnerUser) continue;

        if (prize > 0) {
          winnerUser.winning = (winnerUser.winning || 0) + prize;
          winnerUser.coins   = (winnerUser.coins   || 0) + prize;
          winnerUser.coinWin = (winnerUser.coinWin || 0) + prize;
          winnerUser.matchesWon = (winnerUser.matchesWon || 0) + 1;
          winnerUser.totalWins  = (winnerUser.totalWins  || 0) + 1;
        }

        if (shouldGiveStar(winnerUser.level || 1, pos)) {
          winnerUser.stars = (winnerUser.stars || 0) + 1;
        }
        if ((winnerUser.stars || 0) >= 3) {
          winnerUser.level = (winnerUser.level || 1) + 1;
          winnerUser.stars = 0;
        }
        winnerUser.category = getCategory(winnerUser.level || 1);

        await winnerUser.save({ session });

        if (prize > 0) {
          await Transaction.create([{
            userId:       uid,
            amount:       prize,
            type:         "credit",
            source:       "tournament_win",
            tournamentId: id,
          }], { session });
        }
      }

      const result = new TournamentResult({
        tournamentId: id,
        winners: winners.map(w => ({
          position: Number(w.position),
          userId:   w.userId.toString().trim(),
          username: w.username.toString().trim(),
          prize:    Number(w.prize) || 0,
        })),
        verified: true,
      });
      await result.save({ session });

      if (tournament.status !== "completed") {
        tournament.status = "completed";
        await tournament.save({ session });
      }

      await AuditLog.create([{
        adminId:    req.user._id,
        action:     "RESULT_SUBMIT",
        targetId:   id,
        targetType: "Tournament",
        meta:       { winners, totalWinners: winners.length },
        ip:         req.ip,
        status:     "success",
      }], { session });

      await session.commitTransaction();
      session.endSession();

      const joinedIds = participants.map(j => j.userID).filter(Boolean);
      if (joinedIds.length > 0) {
        notif.notifyResult(tournament, joinedIds).catch(err =>
          console.error("[NOTIF] submitResult:", err.message)
        );
      }

      return res.status(200).json({
        success: true,
        message: "Result submitted and prizes distributed",
        data:    result,
      });

    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------
// Update Tournament
// ----------------------------------------------------------------
exports.updateTournament = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "Tournament ID required" });
    }

    if (req.body.image && req.body.image.trim() !== "") {
      if (!isValidUrl(req.body.image.trim())) {
        return res.status(400).json({
          success: false,
          message: "Invalid image URL. Must be a valid http/https URL."
        });
      }
      req.body.image = req.body.image.trim();
    }

    if (req.body.joinPassword !== undefined && req.body.joinPassword.toString().trim() === "") {
      delete req.body.joinPassword;
    }

    const updated = await Tournament.findByIdAndUpdate(id, req.body, { new: true });

    if (!updated) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    res.status(200).json({
      success:    true,
      message:    "Tournament updated successfully",
      tournament: updated
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// ----------------------------------------------------------------
// Delete Tournament
// ----------------------------------------------------------------
exports.deleteTournament = async (req, res) => {
  try {
    const deleted = await Tournament.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Tournament not found" });
    res.status(200).json({ message: "Tournament deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// ----------------------------------------------------------------
// Get Room Info
// ----------------------------------------------------------------
exports.getRoomInfo = async (req, res) => {
  try {
    const { id }     = req.params;
    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ success: false, message: "Tournament not found" });

    return res.status(200).json({
      success:      true,
      roomId:       tournament.roomId       || "Not set yet",
      roomPassword: tournament.roomPassword || "Not set yet"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};