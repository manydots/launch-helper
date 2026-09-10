DEBUG <- isDebugMode();
NULL <- null;





function requestBuy(obj, skill, nIndex, flag, count) {
	if (sq_getJob(obj) == ENUM_CHARACTERJOB_PRIEST && sq_getGrowType(obj) == GROW_TYPE_AVENGER) {
		if (nIndex == SKILL_AVENGER_AWAKENING) {

			sq_requestBuySkill(SKILL_EXECUTION, flag, count);
		}
	}

	return true;
}

function isGrowTypeAvenger(obj) {
	if (!obj) return false;

	if (sq_getJob(obj) == ENUM_CHARACTERJOB_PRIEST && sq_getGrowType(obj) == GROW_TYPE_AVENGER) return true;

	return false;
}

function onAttack_PassiveObject(passiveobj, damager, bounding_box, is_stuck) {
	if (!passiveobj) return -1;

	if (passiveobj) {
		local pChr = passiveobj.getTopCharacter();

		onAttack_PassiveObject_Fixed(passiveobj, damager, bounding_box, is_stuck);



		if (pChr) {
			if (!isGrowTypeAvenger(pChr)) return -1;




			if (passiveobj.getPassiveObjectIndex() != 24104 && passiveobj.getPassiveObjectIndex() != 24105 &&
				passiveobj.getPassiveObjectIndex() != 24106)
				procDevilStrikeGauge(pChr, passiveobj.getPassiveObjectIndex());
		}
	}

	return 1;
}



function drawGrowAvatarAniType(job, growtype, x, y, isOver, is_draw) {

	if (job == ENUM_CHARACTERJOB_PRIEST && growtype == GROW_TYPE_AVENGER) {
		if (isOver == true && is_draw == true) {
			local getvar = CNAvenger.getStaticVar();

			local auraAni = null;
			if (getvar) {
				auraAni = getvar.GetAnimationMap("1_aura_normal", "Character/Priest/Effect/Animation/ScytheMastery/1_aura_normal.ani");
			}



			sq_AnimationProc(auraAni);
			sq_drawCurrentFrame(auraAni, x, y, false);
		}
	}
}


function drawAppend_VirtualCharacter(job, growtype, x, y, isOver, is_draw) {
	if (job == ENUM_CHARACTERJOB_PRIEST && growtype == GROW_TYPE_AVENGER) {
		if (isOver == true) {
			local getvar = CNAvenger.getStaticVar();

			local auraAni = null;
			if (getvar) {
				auraAni = getvar.GetAnimationMap("1_aura_normal", "Character/Priest/Effect/Animation/ScytheMastery/1_aura_normal.ani");
			}



			sq_AnimationProc(auraAni);
			sq_drawCurrentFrame(auraAni, x, y, false);
		}
	}
}

function sqr_CreatePooledObject(obj, ani_filename, x, y, z, dir) {
	if (!obj) return;

	local ani = obj.sq_createCNRDAnimation(ani_filename);
	local pooledObj = obj.sq_createCNRDPooledObject(ani, true);
	if (pooledObj) {

		pooledObj.setCurrentDirection(dir);
		pooledObj.setCurrentPos(x, y, z);
		obj.sq_AddObject(pooledObj);
	}
}


function sqr_IsNormalAttack(state) {



	if (state == STATE_ATTACK || state == STATE_JUMP_ATTACK || state == STATE_DASH_ATTACK) {
		return true;
	}

	return false;
}



function CreateAimPointMark(parentObj) {
	local job = sq_getJob(parentObj);
	local ani = null;

	if (job == ENUM_CHARACTERJOB_AT_MAGE) {
		ani = sq_CreateAnimation("", "Common/CommonEffect/Animation/atmage_cussor/AimPointMark.ani");
		ani.setRGBA(0, 78, 255, 255);
	}

	return ani;
}

function CNAimPointMarkCustomAnimation(obj, parentObj) {
	if (!obj)
		return false;

	local job = sq_getJob(parentObj);

	if (job == ENUM_CHARACTERJOB_AT_MAGE) {
		local ani1 = sq_CreateAnimation("", "Common/CommonEffect/Animation/atmage_cussor/AimPointMarkDisable.ani");
		local ani2 = sq_CreateAnimation("", "Common/CommonEffect/Animation/atmage_cussor/AimPointMarkVanish.ani");
		local ani3 = sq_CreateAnimation("", "Common/CommonEffect/Animation/atmage_cussor/AimPointMarkDisableVanish.ani");
		local ani4 = sq_CreateAnimation("", "Common/CommonEffect/Animation/atmage_cussor/AimPointMarkEnable.ani");

		if (ani1 && ani2 && ani3 && ani4) {
			ani1.setRGBA(0, 78, 255, 255);
			ani2.setRGBA(0, 78, 255, 255);
			ani3.setRGBA(0, 78, 255, 255);
			ani4.setRGBA(0, 78, 255, 255);

			obj.addCustomAnimation(ani1);
			obj.addCustomAnimation(ani2);
			obj.addCustomAnimation(ani3);
			obj.addCustomAnimation(ani4);

			return true;
		}
	}

	return false;
}




function isMovablePos_CNAimPointMark(obj, parentObj, xPos, yPos) {
	if (!obj)
		return true;

	if (!parentObj)
		return true;

	local job = sq_getJob(parentObj);

	if (job == ENUM_CHARACTERJOB_AT_MAGE) {
		return sq_IsMovablePosCollisionObject(parentObj, xPos, yPos);
	}

	return true;
}


function isBattleMode() {
	local isPvpMode = checkModuleType(MODULE_TYPE_PVP_TYPE);
	local isDungeonMode = checkModuleType(MODULE_TYPE_DUNGEON_TYPE);

	print(" isPvpMode:" + isPvpMode + " isDungeonMode:" + isDungeonMode);

	if (!isPvpMode && !isDungeonMode) {
		return false;
	}

	return true;
}

SKILL_HARD_ATTACK <- 5;
SKILL_TRIPLE_SLASH <- 8;
SKILL_MOMENTARY_SLASH <- 9;
SKILL_ASHEN_FORK <- 16;
SKILL_JUMP_ATTACK_MULTI <- 17;
SKILL_NORMAL_WAVE <- 20;
SKILL_ICE_WAVE <- 21;
SKILL_DARK_FRIENDSHIP <- 29;
SKILL_GRAB_BLAST_BLOOD <- 31;
SKILL_UPPER_SLASH <- 46;
SKILL_VANE_SLASH <- 58;
SKILL_GHOST_STEP_SLASH <- 60;
SKILL_GORE_CROSS <- 64;
SKILL_HOP_SMASH <- 65;
SKILL_CHARGE_CRASH <- 68;
SKILL_RAPID_MOVE_SLASH <- 72;
SKILL_ILLUSION_SLASH <- 73;
SKILL_WAVE_SPIN_AREA <- 74;
SKILL_MOONLIGHT_SLASH <- 77;
SKILL_BLOODY_RAVE <- 79;
SKILL_OUT_RAGE_BREAK <- 81;
SKILL_KALLA <- 82;
SKILL_FLOW_MIND <- 105;

SKILL_SHOCK_WAVE_AREA <- 57;
SKILL_GRAND_WAVE <- 50;
SKILL_REFLECT_GUARD <- 2;
SKILL_TRIPLE_STAB <- 112;
SKILL_GHOST_SIDE_WIND <- 111;



function sq_LoadSkillEffect_DemonicSwordman(obj, skillIndex) {
	if (skillIndex == SKILL_GHOST_SIDE_WIND) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostSideWind_DS/00_sword_normal.ani");
	} else if (skillIndex == SKILL_HARD_ATTACK) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HardAttack1_DS.ani");
	} else if (skillIndex == SKILL_ICE_WAVE) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash_DS/Move1.ani");
	} else if (skillIndex == SKILL_RAPID_MOVE_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash_DS/Move1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash_DS/Move2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash_DS/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash_DS/Slash2.ani");
	} else if (skillIndex == SKILL_GHOST_STEP_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash_DS/Move.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash_DS/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash_DS/Slash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash_DS/Skull.ani");
	} else if (skillIndex == SKILL_TRIPLE_SLASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Slash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Slash3.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Slash4.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Slash5.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Move1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash_DS/Move2.ani");
	} else if (skillIndex == SKILL_MOMENTARY_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_none_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash_DS/momentaryslash_blue_ldodge_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_none_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash_DS/momentaryslash_blue_ldodge_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_white_ldodge_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_white_ldodge_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_red_ldodge_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_red_ldodge_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/Charge1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/Charge2.ani");
	} else if (skillIndex == SKILL_ASHEN_FORK) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackHold_DS.ani");
	} else if (skillIndex == SKILL_JUMP_ATTACK_MULTI) {


		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash1_katana_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash1_katana_upper.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash2_katana_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash2_katana_upper.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash1_under_effect.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash2_under_effect.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash1_upper_effect.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattackslash2_upper_effect.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti_DS/jumpchainattacknormal_upper_effect.ani");
	} else if (skillIndex == SKILL_NORMAL_WAVE) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/NormalWaveSlash_DS.ani");
	} else if (skillIndex == SKILL_GRAB_BLAST_BLOOD) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GrabBlastBlood_DS.ani");
	} else if (skillIndex == SKILL_UPPER_SLASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/UpperSlash1_DS.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/UpperSlash2_DS.ani");
	} else if (skillIndex == SKILL_VANE_SLASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/VaneSlash_DS/Upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/VaneSlash_DS/Dust.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/VaneSlash_DS/Smash.ani");
	} else if (skillIndex == SKILL_GORE_CROSS) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross_DS/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross_DS/Slash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross_DS/Slash3.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross_DS/Slash4.ani");
	} else if (skillIndex == SKILL_HOP_SMASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HopSmash_DS/Sword.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HopSmash_DS/Smash.ani");
	} else if (skillIndex == SKILL_MOONLIGHT_SLASH) {


		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MoonlightSlash1_DS.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MoonlightSlash2_DS.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MoonlightSlashFull.ani");
	} else if (skillIndex == SKILL_BLOODY_RAVE) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Start1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Start2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Loop1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Loop2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Line1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Line2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Typhoon.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/End.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Sword1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Sword2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Sword3.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Sword4.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/(TN)Sword2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/(TN)Sword4.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave_DS/Hit.ani");
	} else if (skillIndex == SKILL_OUT_RAGE_BREAK) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_ready_ldodge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_ready_none.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_slash_ldodge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_slash_none.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_slash_impact_ldodge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_slash_impact_none.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak_DS/sword_slash_stone.ani");
	} else if (skillIndex == SKILL_KALLA) {
		local i = 1;
		for (; i <= 4; ++i)
			obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/Kalla_DS/FinishReady" + i + ".ani");

		for (local j = 1; j <= 3; ++j) {
			for (i = 1; i <= 4; ++i) {
				obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/Kalla_DS/Finish" + j + "-" + i + ".ani");
			}
		}
	} else if (skillIndex == SKILL_WAVE_SPIN_AREA) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/WaveSpinArea_DS/Circle.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/WaveSpinArea_DS/CircleFront.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/WaveSpinArea_DS/CircleBack.ani");
	} else if (skillIndex == SKILL_CHARGE_CRASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash_DS/dash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash_DS/up-slash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash_DS/charge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash_DS/down-slash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash_DS/dustdash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash_DS/dustdashlast.ani");
	} else if (skillIndex == SKILL_ILLUSION_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/IllusionSlash_DS/Upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/IllusionSlash_DS/Smash.ani");
	} else if (skillIndex == SKILL_SHOCK_WAVE_AREA) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ShockWaveArea_DS/Cast.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ShockWaveArea_DS/Smash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ShockWaveArea_DS/Area.ani");
	} else if (skillIndex == SKILL_GRAND_WAVE) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/grandWaveOnCharge1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/grandWaveOnCharge2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/grandWave_DS.ani");
	} else if (skillIndex == SKILL_REFLECT_GUARD) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ReflectGuard_DS/charge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ReflectGuard_DS/slash.ani");
	}

}



function sq_LoadSkillEffect_Swordman(obj, skillIndex) {
	if (skillIndex == SKILL_GHOST_SIDE_WIND) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostSideWind/00_sword_normal.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostSideWind/01_sword_dodge.ani");
	} else if (skillIndex == SKILL_HARD_ATTACK) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HardAttack1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HardAttack2.ani");
	} else if (skillIndex == SKILL_RAPID_MOVE_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash/Move1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash/Move2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/RapidMoveSlash/Slash2.ani");
	} else if (skillIndex == SKILL_GHOST_STEP_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash/Move.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash/Slash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GhostStepSlash/Skull.ani");

	} else if (skillIndex == SKILL_TRIPLE_SLASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Slash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Slash3.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Slash4.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Slash5.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Move1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/TripleSlash/Move2.ani");
	} else if (skillIndex == SKILL_MOMENTARY_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_none_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_blue_ldodge_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_none_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_blue_ldodge_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_white_ldodge_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_white_ldodge_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_red_ldodge_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/momentaryslash_red_ldodge_upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/Charge1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MomentarySlash/Charge2.ani");
	} else if (skillIndex == SKILL_ASHEN_FORK) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackHold.ani");
	} else if (skillIndex == SKILL_JUMP_ATTACK_MULTI) {


		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash1_katana_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash1_katana_upper.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash2_katana_under.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash2_katana_upper.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash1_under_effect.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash2_under_effect.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash1_upper_effect.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattackslash2_upper_effect.ani");

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/JumpAttackMulti/jumpchainattacknormal_upper_effect.ani");
	} else if (skillIndex == SKILL_NORMAL_WAVE) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/NormalWaveSlash.ani");
	} else if (skillIndex == SKILL_GRAB_BLAST_BLOOD) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GrabBlastBlood.ani");
	} else if (skillIndex == SKILL_UPPER_SLASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/UpperSlash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/UpperSlash2.ani");
	} else if (skillIndex == SKILL_VANE_SLASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/VaneSlash/Upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/VaneSlash/Dust.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/VaneSlash/Smash.ani");
	} else if (skillIndex == SKILL_GORE_CROSS) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross/Slash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross/Slash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross/Slash3.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/GoreCross/Slash4.ani");
	} else if (skillIndex == SKILL_HOP_SMASH) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HopSmash/Sword.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/HopSmash/Smash.ani");
	} else if (skillIndex == SKILL_MOONLIGHT_SLASH) {


		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MoonlightSlash1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MoonlightSlash2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/MoonlightSlashFull.ani");
	} else if (skillIndex == SKILL_BLOODY_RAVE) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Start1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Start2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Loop1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Loop2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Line1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Line2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Typhoon.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/End.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Sword1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Sword2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Sword3.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Sword4.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/(TN)Sword2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/(TN)Sword4.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/BloodyRave/Hit.ani");
	} else if (skillIndex == SKILL_OUT_RAGE_BREAK) {

		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_ready_ldodge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_ready_none.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_slash_ldodge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_slash_none.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_slash_impact_ldodge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_slash_impact_none.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/OutRageBreak/sword_slash_stone.ani");
	} else if (skillIndex == SKILL_KALLA) {
		for (local i = 1; i <= 4; ++i)
			obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/Kalla/FinishReady" + i + ".ani");

		for (local j = 1; j <= 3; ++j)
			for (local i = 1; i <= 4; ++i)
				obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/Kalla/Finish" + j + "-" + i + ".ani");
	} else if (skillIndex == SKILL_WAVE_SPIN_AREA) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/WaveSpinArea/Circle.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/WaveSpinArea/CircleFront.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/WaveSpinArea/CircleBack.ani");
	} else if (skillIndex == SKILL_CHARGE_CRASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash/dash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash/up-slash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash/charge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash/down-slash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash/dustdash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ChargeCrash/dustdashlast.ani");
	} else if (skillIndex == SKILL_ILLUSION_SLASH) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/IllusionSlash/Upper.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/IllusionSlash/Smash.ani");
	} else if (skillIndex == SKILL_SHOCK_WAVE_AREA) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ShockWaveArea/Cast.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ShockWaveArea/Smash.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ShockWaveArea/Area.ani");
	} else if (skillIndex == SKILL_GRAND_WAVE) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/grandWaveOnCharge1.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/grandWaveOnCharge2.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/grandWave.ani");
	} else if (skillIndex == SKILL_REFLECT_GUARD) {
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ReflectGuard/charge.ani");
		obj.sq_LoadSkillEffectAni(skillIndex, "Effect/Animation/ReflectGuard/slash.ani");
	}
}


function getDist2(x1, y1, x2, y2) {
	local i = 0;

	local dx = x1 - x2;

	local dy = y1 - y2;

	local sum = (dx * dx) + (dy * dy);

	if (dx < 0)
		dx = -dx;

	if (dy < 0)
		dy = -dy;

	if (dx > dy)
		i = dx;
	else
		i = dy;

	while ((i * i) < sum) {
		i = i + 2;
	}

	i = i - 1;

	if ((i * i) < sum)
		i = i + 1;

	return i;

}


function getCurrentModuleDamageRate(obj) {
	if (!obj)
		return 1.0;

	local rate = 1.0;

	switch (sq_getJob(obj)) {
		case ENUM_CHARACTERJOB_SWORDMAN:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_FIGHTER:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_GUNNER:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			if (CNSquirrelAppendage.sq_IsAppendAppendage(obj, "character/gunner/appendage/ap_skill52.nut"))
				rate += obj.sq_GetLevelData(52, 1, sq_GetSkillLevel(obj, 52)) / 1000.0;
			break;
		case ENUM_CHARACTERJOB_MAGE:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_PRIEST:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_AT_GUNNER:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			if (CNSquirrelAppendage.sq_IsAppendAppendage(obj, "character/atgunner/appendage/ap_skill52.nut"))
				rate += obj.sq_GetLevelData(52, 1, sq_GetSkillLevel(obj, 52)) / 1000.0;
			break;
		case ENUM_CHARACTERJOB_THIEF:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_AT_FIGHTER:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_AT_MAGE:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_DEMONIC_SWORDMAN:
			switch (sq_getGrowType(obj)) {
				case 0:
					break;
				case 1:
					break;
				case 2:
					break;
				case 3:
					break;
				case 4:
					break;
			}
			break;
		case ENUM_CHARACTERJOB_CREATOR_MAGE:
			if (obj.getState() != 108) {
				switch (sq_getGrowType(obj)) {
					case 0:
						break;
					case 1:
						break;
					case 2:
						break;
					case 3:
						break;
					case 4:
						break;
				}
			}
			break;
	}
	return rate;
}

function onAttack_PassiveObject_Fixed(passiveobj, damager, bounding_box, is_stuck) {
	if (!passiveobj.isMyControlObject()) return;
	local obj = sq_GetCNRDObjectToSQRCharacter(passiveobj.getTopCharacter());
	local ID = passiveobj.getPassiveObjectIndex();
	local power = -1;

	switch (ID) {
		case 60048:
		case 60049:
		case 60050:
		case 60051:

			if (!CNSquirrelAppendage.sq_IsAppendAppendage(obj, "appendage/equipment/ap_tutu.nut")) {
				local appendage = CNSquirrelAppendage.sq_AppendAppendage(obj, obj, 255, true, "appendage/equipment/ap_tutu.nut", true);
				appendage.getVar("passiveobj").clear_obj_vector();
				appendage.getVar("passiveobj").push_obj_vector(passiveobj);
			}
			break;
		case 22269:
			switch (passiveobj.getState()) {
				case 3:
					power = obj.sq_GetPowerWithPassive(96, -1, 0, -1, 1.0);
					break;
			}
			break;
		case 22271:
			switch (passiveobj.getState()) {
				case 2:
					power = obj.sq_GetPowerWithPassive(96, -1, 1, -1, 1.0);
					break;
				case 3:
					power = obj.sq_GetPowerWithPassive(96, -1, 2, -1, 1.0);
					break;
			}
			break;
		case 22272:
			switch (passiveobj.getState()) {
				case 2:
					power = obj.sq_GetPowerWithPassive(96, -1, 3, -1, 1.0);
					break;
				case 3:
					power = obj.sq_GetPowerWithPassive(96, -1, 4, -1, 1.0);
					break;
			}
			break;
		case 20051:
			switch (obj.getState()) {
				case 47:
					power = obj.sq_GetPowerWithPassive(86, -1, 0, -1, 1.0);
					break;
				case 48:
					power = obj.sq_GetPowerWithPassive(86, -1, 1, -1, 1.0);
					break;
				case 49:
					power = obj.sq_GetPowerWithPassive(86, -1, 1, -1, 1.0);
					break;
			}
			break;
		case 21021:
			local attackBonusRatey = sq_GetCurrentAttackBonusRate(passiveobj);
			local attackBonusRate1 = obj.sq_GetBonusRateWithPassive(67, -1, 2, 0.7);
			local attackBonusRate2 = obj.sq_GetBonusRateWithPassive(67, -1, 2, 0.9);
			local attackBonusRate3 = obj.sq_GetBonusRateWithPassive(67, -1, 2, 1.0);

			if (attackBonusRatey == attackBonusRate1) {
				power = obj.sq_GetPowerWithPassive(67, -1, 2, -1, 0.7);
			} else if (attackBonusRatey == attackBonusRate2) {
				power = obj.sq_GetPowerWithPassive(67, -1, 2, -1, 0.9);
			} else if (attackBonusRatey == attackBonusRate3) {
				power = obj.sq_GetPowerWithPassive(67, -1, 2, -1, 1.0);
			}
			break;
		case 22234:
			switch (passiveobj.getState()) {
				case 2:
					power = obj.sq_GetPowerWithPassive(70, -1, 1, -1, 1.0);
					break;
				case 3:
					power = obj.sq_GetPowerWithPassive(70, -1, 4, -1, 1.0);
					break;
			}
			break;
		case 22235:
			local parentObjIndex = passiveobj.getParent().getCollisionObjectIndex();
			power = obj.sq_GetPowerWithPassive(70, -1, 2, -1, 1.0);
			if (parentObjIndex == 22232) {
				power = obj.sq_GetPowerWithPassive(70, -1, 3, -1, 1.0);
			}
			break;
		case 22236:
			power = obj.sq_GetPowerWithPassive(70, -1, 5, -1, 1.0);
			break;
		case 22228:
			power = obj.sq_GetPowerWithPassive(67, -1, 0, -1, 1.0);
			break;
		case 22211:
			switch (passiveobj.getState()) {
				case 3:
					power = obj.sq_GetPowerWithPassive(54, -1, 0, -1, 1.0);
					break;
				case 4:
					power = obj.sq_GetPowerWithPassive(54, -1, 1, -1, 1.0);
					break;
			}
			break;
		case 24030:
			power = obj.sq_GetPowerWithPassive(93, -1, 1, -1, 1.0);
			break;
		case 25020:
			switch (obj.getState()) {
				case 15:
					power = obj.sq_GetPowerWithPassive(37, -1, 13, -1, 1.0);
					break;
				default:
					power = obj.sq_GetPowerWithPassive(59, -1, 2, -1, 1.0);
					break;
			}
			break;
		case 25021:
			power = obj.sq_GetPowerWithPassive(59, -1, 2, -1, 1.0);
			break;
		case 23033:
		case 23034:
		case 23035:
		case 23036:
			local attackBonusRatey = sq_GetCurrentAttackBonusRate(passiveobj);
			local attackBonusRate1 = obj.sq_GetBonusRateWithPassive(74, -1, 0, 1.0);
			local attackBonusRate2 = obj.sq_GetBonusRateWithPassive(74, -1, 1, 1.0);
			local attackBonusRate3 = obj.sq_GetBonusRateWithPassive(74, -1, 3, 1.0);
			local attackBonusRate4 = obj.sq_GetBonusRateWithPassive(74, -1, 4, 1.0);

			if (attackBonusRatey == attackBonusRate1) {
				power = obj.sq_GetPowerWithPassive(74, -1, 0, -1, 1.0);
			} else if (attackBonusRatey == attackBonusRate2) {
				power = obj.sq_GetPowerWithPassive(74, -1, 1, -1, 1.0);
			} else if (attackBonusRatey == attackBonusRate3) {
				power = obj.sq_GetPowerWithPassive(74, -1, 3, -1, 1.0);
			} else if (attackBonusRatey == attackBonusRate4) {
				power = obj.sq_GetPowerWithPassive(74, -1, 4, -1, 1.0);
			}
			break;
		case 24034:
			switch (passiveobj.getState()) {
				case 3:
					power = obj.sq_GetPowerWithPassive(101, -1, 0, -1, 1.0);
					break;
				case 5:
					power = obj.sq_GetPowerWithPassive(101, -1, 1, -1, 1.0);
					break;
			}
			break;
		case 23024:
			if (CNSquirrelAppendage.sq_IsAppendAppendage(obj, "character/mage/appendage/ap_bellatrix.nut") == true) {
				power = obj.sq_GetPowerWithPassive(83, -1, 15, -1, 1.0);
			}
			break;
		case 21019:
			power = obj.sq_GetPowerWithPassive(64, -1, 2, -1, 1.0);
			break;
		case 30567:
			local parentObj = passiveobj.getParent();
			if (parentObj && parentObj.isMyControlObject() && parentObj.getCollisionObjectIndex() == MONSTER_INDEX_MAGE_SUMMONCASILLAS) {
				power = obj.sq_GetPowerWithPassive(82, -1, 13, -1, 1.0);
			}
			break;
		case 22224:
			local parentObj = passiveobj.getParent();
			if (parentObj && parentObj.isMyControlObject()) {
				switch (parentObj.getCollisionObjectIndex()) {
					case 60041:
					case 60018:
						power = obj.sq_GetPowerWithPassive(63, -1, 1, -1, 1.0);
						break;
				}
			}
			break;
		case 22225:
			local parentObj = passiveobj.getParent();
			if (parentObj && parentObj.isMyControlObject()) {
				switch (parentObj.getCollisionObjectIndex()) {
					case 60041:
					case 60018:
						power = obj.sq_GetPowerWithPassive(63, -1, 2, -1, 1.0);
						break;
				}
			}
			break;
		case 22226:
			if (obj.getVar("robottempesterdash").getBool(0)) {
				obj.getVar("robottempesterdash").setBool(0, false);
				power = obj.sq_GetPowerWithPassive(63, -1, 4, -1, 1.0);
			}
			break;
		case 22264:
			switch (obj.getState()) {
				case 53:
					power = obj.sq_GetPowerWithPassive(100, -1, 4, -1, 1.0) + obj.sq_GetPowerWithPassive(100, -1, 5, -1, 1.0);
					break;
				case 46:
					power = obj.sq_GetPowerWithPassive(100, -1, 12, -1, 1.0);
					break;
			}
			break;
		case 22273:
		case 22274:
			switch (obj.getState()) {
				case 54:
					power = obj.sq_GetPowerWithPassive(100, -1, 6, -1, 1.0);
					break;
			}
			break;
		case 22275:
			switch (obj.getState()) {
				case 49:
					switch (obj.getSkillSubState()) {
						case 0:
							power = obj.sq_GetPowerWithPassive(100, -1, 13, -1, 1.0);
							break;
						case 1:
							power = obj.sq_GetPowerWithPassive(100, -1, 14, -1, 1.0);
							break;
					}
					break;
				case 51:
					power = obj.sq_GetPowerWithPassive(100, -1, 13, -1, 1.0);
					break;
			}
			break;
		case 22276:
			local ani = obj.sq_GetCurrentAni();
			local invokingAni = 0;
			switch (obj.getState()) {
				case 50:
					power = obj.sq_GetPowerWithPassive(100, -1, 15, -1, 1.0);
					break;
			}
			break;
		case 22277:
			power = obj.sq_GetPowerWithPassive(100, -1, 16, -1, 1.0);
			break;
		case 20054:
			local frameIndex = sq_GetCurrentFrameIndex(passiveobj);
			if (frameIndex >= 0 && frameIndex < 9) {
				power = obj.sq_GetPowerWithPassive(87, -1, 3, -1, 1.0);
			}
			if (frameIndex >= 9) {
				local initAttackBonusRate = obj.sq_GetBonusRateWithPassive(87, -1, 4, 1.0);
				local attackBonusRate = sq_GetCurrentAttackBonusRate(passiveobj);
				local percentageDifference = 0.0;
				if (attackBonusRate != 0) {
					percentageDifference = (attackBonusRate.tofloat() - initAttackBonusRate.tofloat()) / initAttackBonusRate.tofloat();
					obj.getVar("blache").setFloat(0, percentageDifference);
				} else {
					percentageDifference = obj.getVar("blache").getFloat(0);
				}
				power = obj.sq_GetPowerWithPassive(87, -1, 4, -1, 1.0 + percentageDifference);
				if (power > obj.sq_GetPowerWithPassive(87, -1, 5, -1, 1.0)) {
					power = obj.sq_GetPowerWithPassive(87, -1, 5, -1, 1.0);
				}
			}
			break;
		case 22278:
			power = obj.sq_GetPowerWithPassive(98, -1, 3, -1, 1.0);
			break;
		case 22280:
			power = obj.sq_GetPowerWithPassive(98, -1, 0, -1, 1.0);
			break;
		case 22281:
			power = obj.sq_GetPowerWithPassive(98, -1, 2, -1, 1.0);
			break;
	}

	if (power != -1) {
		local attackInfo = sq_GetCurrentAttackInfo(passiveobj);
		sq_SetAddWeaponDamage(attackInfo, false);
		sq_SetCurrentAttackBonusRate(attackInfo, 0);
		sq_SetCurrentAttackPower(attackInfo, power);
	}
}

function CharacterConvertPercentageToFixed(obj, skillIndex, skillDataIndex) {
	sq_SetAddWeaponDamage(sq_GetCurrentAttackInfo(obj), false);
	obj.sq_SetCurrentAttackBonusRate(0);
	obj.sq_SetCurrentAttackPower(obj.sq_GetPowerWithPassive(skillIndex, -1, skillDataIndex, -1, 1.0));
}