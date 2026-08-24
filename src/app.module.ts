import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './common/audit';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { ChildrenModule } from './modules/children/children.module';
import { DevicesModule } from './modules/devices/devices.module';
import { SyncModule } from './modules/sync/sync.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { FeedingModule } from './modules/feeding/feeding.module';
import { StedModule } from './modules/sted/sted.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { UsersModule } from './modules/users/users.module';
import { CentersModule } from './modules/centers/centers.module';
import { ClassroomsModule } from './modules/classrooms/classrooms.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { SettingsModule } from './modules/settings/settings.module';
import { GeoModule } from './modules/geo/geo.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WashModule } from './modules/wash/wash.module';
import { CenterRegisterModule } from './modules/center-register/center-register.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    DevicesModule,
    SyncModule,
    ChildrenModule,
    TransfersModule,
    NutritionModule,
    FeedingModule,
    AttendanceModule,
    UsersModule,
    StedModule,
    ReferralsModule,
    CentersModule,
    ClassroomsModule,
    AnalyticsModule,
    AlertsModule,
    MonitoringModule,
    ReportsModule,
    AuditLogsModule,
    SettingsModule,
    GeoModule,
    ComplianceModule,
    WashModule,
    CenterRegisterModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
