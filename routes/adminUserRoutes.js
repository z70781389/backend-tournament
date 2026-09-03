const express = require("express");
const router  = express.Router();

const { adminOnly } = require("../middleware/authMiddleware");
const adminUserController = require("../controllers/adminController");

router.get("/",              adminOnly, adminUserController.getAllUsers);
router.post("/search",       adminOnly, adminUserController.searchUser);
router.get("/:userId",       adminOnly, adminUserController.getUserDetails);
router.post("/:userId/warn", adminOnly, adminUserController.warnUser);
router.post("/:userId/block",   adminOnly, adminUserController.blockUser);
router.post("/:userId/unblock", adminOnly, adminUserController.unblockUser);
router.post("/add-balance",  adminOnly, adminUserController.addBalance);

module.exports = router;