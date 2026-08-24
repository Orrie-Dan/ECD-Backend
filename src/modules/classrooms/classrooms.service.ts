import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomAssignmentReason, ClassroomGrade, ChildStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { BulkPromoteResponseDto, ClassroomResponseDto } from './dto/classroom-response.dto';

const GRADE_LABELS: Record<ClassroomGrade, string> = {
  grade_1: 'Grade 1 / Umwaka wa 1',
  grade_2: 'Grade 2 / Umwaka wa 2',
  grade_3: 'Grade 3 / Umwaka wa 3',
};

const NEXT_GRADE: Record<string, ClassroomGrade | null> = {
  grade_1: ClassroomGrade.grade_2,
  grade_2: ClassroomGrade.grade_3,
  grade_3: null,
};

@Injectable()
export class ClassroomsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByCenter(centerId: string): Promise<ClassroomResponseDto[]> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: centerId, deletedAt: null },
      select: { id: true },
    });
    if (!center) {
      throw new NotFoundException('Center not found');
    }

    const classrooms = await this.prisma.classroom.findMany({
      where: { centerId },
      include: {
        _count: {
          select: {
            children: {
              where: { deletedAt: null, status: ChildStatus.active },
            },
          },
        },
      },
      orderBy: { grade: 'asc' },
    });

    return classrooms.map((c) => ({
      id: c.id,
      centerId: c.centerId,
      grade: c.grade,
      label: GRADE_LABELS[c.grade],
      childrenCount: c._count.children,
      createdAt: c.createdAt,
    }));
  }

  async findOne(id: string): Promise<ClassroomResponseDto> {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: {
              where: { deletedAt: null, status: ChildStatus.active },
            },
          },
        },
      },
    });

    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    return {
      id: classroom.id,
      centerId: classroom.centerId,
      grade: classroom.grade,
      label: GRADE_LABELS[classroom.grade],
      childrenCount: classroom._count.children,
      createdAt: classroom.createdAt,
    };
  }

  async promoteChild(user: AuthUser, childId: string, effectiveDate: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      include: { classroom: true },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }
    if (!child.classroomId || !child.classroom) {
      throw new BadRequestException('Child is not assigned to a classroom');
    }

    const nextGrade = NEXT_GRADE[child.classroom.grade];
    if (!nextGrade) {
      throw new BadRequestException(
        'Child is in Grade 3 and cannot be promoted further. Archive instead.',
      );
    }

    const nextClassroom = await this.prisma.classroom.findUnique({
      where: {
        centerId_grade: {
          centerId: child.centerId,
          grade: nextGrade,
        },
      },
    });

    if (!nextClassroom) {
      throw new NotFoundException('Next grade classroom not found for this center');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.child.update({
        where: { id: child.id },
        data: {
          classroomId: nextClassroom.id,
          updatedAt: new Date(),
          updatedById: user.id,
          version: { increment: 1 },
        },
      });

      await tx.classroomAssignmentHistory.create({
        data: {
          id: randomUUID(),
          childId: child.id,
          fromClassroomId: child.classroomId,
          toClassroomId: nextClassroom.id,
          reason: ClassroomAssignmentReason.promotion,
          effectiveDate: new Date(effectiveDate),
          createdById: user.id,
        },
      });

      return tx.child.findUniqueOrThrow({
        where: { id: child.id },
        include: { classroom: true },
      });
    });

    return {
      id: updated.id,
      classroomId: updated.classroomId!,
      classroomGrade: updated.classroom!.grade,
    };
  }

  async bulkPromote(
    user: AuthUser,
    centerId: string,
    effectiveDate: string,
    excludeChildIds: string[] = [],
  ): Promise<BulkPromoteResponseDto> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: centerId, deletedAt: null },
      select: { id: true },
    });
    if (!center) {
      throw new NotFoundException('Center not found');
    }

    const classrooms = await this.prisma.classroom.findMany({
      where: { centerId },
    });
    const gradeMap = new Map(classrooms.map((c) => [c.grade, c]));

    const children = await this.prisma.child.findMany({
      where: {
        centerId,
        deletedAt: null,
        status: ChildStatus.active,
        classroomId: { not: null },
        id: { notIn: excludeChildIds },
      },
      include: { classroom: true },
    });

    const grade3ChildIds: string[] = [];
    let promotedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const child of children) {
        if (!child.classroom) continue;

        const nextGrade = NEXT_GRADE[child.classroom.grade];
        if (!nextGrade) {
          grade3ChildIds.push(child.id);
          continue;
        }

        const nextClassroom = gradeMap.get(nextGrade);
        if (!nextClassroom) continue;

        await tx.child.update({
          where: { id: child.id },
          data: {
            classroomId: nextClassroom.id,
            updatedAt: new Date(),
            updatedById: user.id,
            version: { increment: 1 },
          },
        });

        await tx.classroomAssignmentHistory.create({
          data: {
            id: randomUUID(),
            childId: child.id,
            fromClassroomId: child.classroomId,
            toClassroomId: nextClassroom.id,
            reason: ClassroomAssignmentReason.promotion,
            effectiveDate: new Date(effectiveDate),
            createdById: user.id,
          },
        });

        promotedCount++;
      }
    });

    // Also include excluded grade-3 children in the response
    const excludedGrade3 = await this.prisma.child.findMany({
      where: {
        centerId,
        deletedAt: null,
        status: ChildStatus.active,
        id: { in: excludeChildIds },
        classroom: { grade: ClassroomGrade.grade_3 },
      },
      select: { id: true },
    });
    grade3ChildIds.push(...excludedGrade3.map((c) => c.id));

    return { promotedCount, grade3ChildIds };
  }

  /**
   * Compute the appropriate grade for a child based on date of birth.
   * Rwanda ECD cycle: Grade 1 = age ≤ 3, Grade 2 = age 4–5, Grade 3 = age ≥ 6.
   */
  static gradeFromDob(dateOfBirth: Date, referenceDate = new Date()): ClassroomGrade {
    let age = referenceDate.getFullYear() - dateOfBirth.getFullYear();
    const m = referenceDate.getMonth() - dateOfBirth.getMonth();
    if (m < 0 || (m === 0 && referenceDate.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    if (age <= 3) return ClassroomGrade.grade_1;
    if (age <= 5) return ClassroomGrade.grade_2;
    return ClassroomGrade.grade_3;
  }

  /**
   * Auto-assign a child to the correct classroom for their center based on DOB.
   * Returns the classroomId, or null if the classroom doesn't exist.
   */
  static async autoAssignClassroom(
    tx: Prisma.TransactionClient,
    childId: string,
    centerId: string,
    dateOfBirth: Date,
    createdById?: string,
  ): Promise<string | null> {
    const grade = ClassroomsService.gradeFromDob(dateOfBirth);
    const classroom = await tx.classroom.findUnique({
      where: { centerId_grade: { centerId, grade } },
    });
    if (!classroom) return null;

    await tx.child.update({
      where: { id: childId },
      data: { classroomId: classroom.id },
    });

    await tx.classroomAssignmentHistory.create({
      data: {
        id: randomUUID(),
        childId,
        fromClassroomId: null,
        toClassroomId: classroom.id,
        reason: ClassroomAssignmentReason.initial_enrollment,
        effectiveDate: new Date(),
        createdById: createdById ?? null,
      },
    });

    return classroom.id;
  }

  /**
   * Create the 3 fixed classrooms for a center within a transaction.
   */
  static async seedClassroomsForCenter(
    tx: Prisma.TransactionClient,
    centerId: string,
  ): Promise<void> {
    const grades = [ClassroomGrade.grade_1, ClassroomGrade.grade_2, ClassroomGrade.grade_3];

    for (const grade of grades) {
      await tx.classroom.create({
        data: {
          id: randomUUID(),
          centerId,
          grade,
        },
      });
    }
  }
}
