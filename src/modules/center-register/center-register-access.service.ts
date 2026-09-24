import { Injectable, NotFoundException } from '@nestjs/common';
import { assertCenterAccessible } from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CenterSummary } from './center-register.scope';

@Injectable()
export class CenterRegisterAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCenter(centerId: string): Promise<CenterSummary> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true, villageId: true },
    });
    if (!center) {
      throw new NotFoundException('Center not found');
    }
    return center;
  }

  async assertReadableCenter(user: AuthUser, centerId: string): Promise<CenterSummary> {
    const center = await this.requireCenter(centerId);
    await assertCenterAccessible(this.prisma, user, {
      id: center.id,
      districtId: center.districtId,
      villageId: center.villageId,
    });
    return center;
  }

  async requireChildInCenter(childId: string, centerId: string): Promise<void> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: { id: true, centerId: true },
    });
    if (!child) {
      throw new NotFoundException('Child not found');
    }
    if (child.centerId !== centerId) {
      throw new NotFoundException('Child not found at this center');
    }
  }
}
