import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CenterSummary } from './center-register.scope';

@Injectable()
export class CenterRegisterAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCenter(centerId: string): Promise<CenterSummary> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true },
    });
    if (!center) {
      throw new NotFoundException('Center not found');
    }
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
