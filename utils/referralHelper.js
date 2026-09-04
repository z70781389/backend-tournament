// Shared referral logic used by both user-facing referralController
// and admin routes (adminRoutes.js) — avoids duplicating milestone/count logic.

const Referral = require("../models/Referral");

// 🚨 Backend-authoritative milestone config. Client NEVER sends reward amount.
const MILESTONES = [
  { count: 5, reward: 15 },
  { count: 10, reward: 20 },
];

// Easily replaceable later — set WEBSITE_URL in env for production.
const WEBSITE_URL = process.env.WEBSITE_URL || "https://soloclash.online";
function buildReferralLink(referralCode) {
  return `${WEBSITE_URL}/signup?ref=${referralCode}`;
}

async function getQualifiedCount(referrerId) {
  return Referral.countDocuments({ referrer: referrerId, qualified: true });
}

async function getTotalReferredCount(referrerId) {
  return Referral.countDocuments({ referrer: referrerId });
}

// Returns milestone list annotated with locked/unlocked/claimed/available status
function getMilestoneStatuses(user, qualifiedCount) {
  const claimed = user.referralRewardsClaimed || [];
  return MILESTONES.map((m) => {
    const isClaimed = claimed.includes(m.count);
    const isUnlocked = qualifiedCount >= m.count;
    let status;
    if (isClaimed) status = "claimed";
    else if (isUnlocked) status = "available";
    else status = "locked";

    return {
      requiredCount: m.count,
      reward: m.reward,
      status,
    };
  });
}

function findMilestone(count) {
  return MILESTONES.find((m) => m.count === count);
}

module.exports = {
  MILESTONES,
  buildReferralLink,
  getQualifiedCount,
  getTotalReferredCount,
  getMilestoneStatuses,
  findMilestone,
};