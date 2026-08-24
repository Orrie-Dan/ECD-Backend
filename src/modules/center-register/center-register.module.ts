import { Module } from '@nestjs/common';
import { CenterRegisterAccessService } from './center-register-access.service';
import { CenterSupportController } from './center-support.controller';
import { CenterSupportService } from './center-support.service';
import { CenterVisitsController } from './center-visits.controller';
import { CenterVisitsService } from './center-visits.service';
import { CommitteeMembersController } from './committee-members.controller';
import { CommitteeMembersService } from './committee-members.service';
import { ParentContributionsController } from './parent-contributions.controller';
import { ParentContributionsService } from './parent-contributions.service';
import { ParentingSessionsController } from './parenting-sessions.controller';
import { ParentingSessionsService } from './parenting-sessions.service';
import { StaffTrainingsController } from './staff-trainings.controller';
import { StaffTrainingsService } from './staff-trainings.service';

@Module({
  controllers: [
    ParentContributionsController,
    ParentingSessionsController,
    CommitteeMembersController,
    CenterSupportController,
    CenterVisitsController,
    StaffTrainingsController,
  ],
  providers: [
    CenterRegisterAccessService,
    ParentContributionsService,
    ParentingSessionsService,
    CommitteeMembersService,
    CenterSupportService,
    CenterVisitsService,
    StaffTrainingsService,
  ],
})
export class CenterRegisterModule {}
