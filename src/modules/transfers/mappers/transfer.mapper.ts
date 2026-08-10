import { ChildTransfer } from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { TransferResponseDto } from '../dto/transfer-response.dto';

type TransferEntity = Pick<
  ChildTransfer,
  | 'id'
  | 'childId'
  | 'fromCenterId'
  | 'toCenterId'
  | 'transferDate'
  | 'reason'
  | 'notes'
  | 'status'
  | 'initiatedById'
  | 'acceptedAt'
  | 'acceptedById'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
>;

export class TransferMapper implements Mapper<TransferEntity, TransferResponseDto> {
  toDto(entity: TransferEntity): TransferResponseDto {
    return {
      id: entity.id,
      childId: entity.childId,
      fromCenterId: entity.fromCenterId,
      toCenterId: entity.toCenterId,
      transferDate: entity.transferDate,
      reason: entity.reason,
      notes: entity.notes,
      status: entity.status,
      initiatedBy: entity.initiatedById,
      acceptedAt: entity.acceptedAt,
      acceptedBy: entity.acceptedById,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export const transferMapper = new TransferMapper();
