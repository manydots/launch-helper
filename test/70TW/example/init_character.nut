function sq_InitFrameIndices(obj) {
	if (!obj)
		return -1;

	// 占쏙옙占쏙옙占쏙옙
	if (sq_getJob(obj) == ENUM_CHARACTERJOB_AT_MAGE) {
		// 占쏙옙占쏙옙占쌀띰옙 占쏙옙 占쏙옙占쏙옙 占쏙옙占쏙옙占쏙옙트占쏙옙 占쏙옙占쏙옙占쏙옙 占싸쇽옙占쏙옙 占쏙옙占쏙옙
		obj.sq_JumpUpStartFrame(1);
		obj.sq_JumpDownStartFrame(3);
		obj.sq_JumpLandStartFrame(9);


		// 캐占쏙옙占쏙옙 占쌕울옙�占� 占쏙옙 占쏙옙占쏙옙 占쏙옙占쏙옙占쏙옙트占쏙옙 占쏙옙占쏙옙占쏙옙 占싸듸옙占쏙옙 占쏙옙占쏙옙
		obj.sq_SetDownUpFrame(2);
		obj.sq_SetDownDownFrame(2);
		obj.sq_SetDownBounceUpFrame(2);
		obj.sq_SetDownBounceDownFrame(3);
		obj.sq_SetDownLieFrame(4);


		obj.sq_AddAttackCancelStartFrame(3); // 1타 캔占쏙옙 占쏙옙占쏙옙占쏙옙
		obj.sq_AddAttackCancelStartFrame(3); // 2타 캔占쏙옙 占쏙옙占쏙옙占쏙옙
		obj.sq_AddAttackCancelStartFrame(3); // 3타 캔占쏙옙 占쏙옙占쏙옙占쏙옙



		// 占쏙옙占쏙옙占쏙옙 占썩본 占쏙옙占쏙옙 占승깍옙 占쏙옙占�
		obj.sq_SetSoundTagCreatureCommand("MW_CMDPET");
		obj.sq_SetSoundTagLackMp("MW_NOMANA");
		obj.sq_SetSoundTagCoolTime("R_MW_COOLTIME");
		obj.sq_SetSoundTagDie("MW_DIE");
		obj.sq_SetSoundTagBackStepStart("MW_BACK");
		obj.sq_SetSoundTagThrowItem("R_MW_THROW");


		// 占쏙옙占쏙옙占쏙옙 占쏙옙占쏙옙占쏙옙 占쏙옙占쏙옙
		obj.setThrowObjectAnimationIndex(3);
		obj.setThrowObjectZDistance(65);
		obj.setThrowObjectXDistance(45);
		obj.setThrowObjectFrameIndex(1);
	} else if (sq_getJob(obj) == ENUM_CHARACTERJOB_CREATOR_MAGE) {
		// 占쏙옙占쏙옙占쏙옙 占썩본 占쏙옙占쏙옙 占승깍옙 占쏙옙占�
		obj.sq_SetSoundTagCreatureCommand("CR_CMDPET");
		obj.sq_SetSoundTagLackMp("R_CR_NOMANA");
		obj.sq_SetSoundTagCoolTime("R_CR_COOLTIME");
		obj.sq_SetSoundTagDie("R_CR_DIE");
		obj.sq_SetSoundTagBackStepStart("R_CR_JUMP");
		obj.sq_SetSoundTagThrowItem("R_CR_THROW");
	}

	return 0;
}


// 크占쏙옙占쏙옙占쏙옙占싶곤옙 占쏙옙占쏙옙占심띰옙 占쌔억옙占쏙옙占싹듸옙
function create_CreatorMage(obj) {}

// 처占쏙옙 캐占쏙옙占싶몌옙 占쏙옙占쏙옙트 占쏙옙占쏙옙占쏙옙 호占쏙옙풔占� 占쌥뱄옙占쌉쇽옙 占쌉니댐옙.
function onSetCharacter(obj) {
	print(" onSetCharacter:" + obj + " job:" + sq_getJob(obj));

	if (sq_getJob(obj) == ENUM_CHARACTERJOB_CREATOR_MAGE) {
		sq_SetExSkillSlotVisible(false);
		sq_SetSkillSlotVisible(5, false);
		sq_SetSkillSlotEnable(5, false);

		local SKILLICON_START_X = 540;
		local SKILLICON_START_Y = 555;

		for (local i = 0; i < 5; i++) {
			sq_SetSkillSlotPos(i, SKILLICON_START_X + (i * 36), SKILLICON_START_Y);
		}
	} else {
		sq_SetExSkillSlotVisible(true);
		sq_SetSkillSlotVisible(5, true);
		sq_SetSkillSlotEnable(5, true);

		local SKILLICON_START_X = 538;
		local SKILLICON_START_Y = 558;


		for (local i = 0; i < 6; i++) {
			sq_SetSkillSlotPos(i, SKILLICON_START_X + (i * 30), SKILLICON_START_Y);
		}
	}
}