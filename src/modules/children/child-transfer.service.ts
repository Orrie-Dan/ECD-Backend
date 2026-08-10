/**
 * @deprecated Transfer lifecycle moved to TransferLifecycleService
 * (`src/modules/transfers/transfer-lifecycle.service.ts`).
 * Kept temporarily for import compatibility; do not use for new code.
 */
export {
  TransferLifecycleService as ChildTransferService,
  type CreatePendingTransferInput as ApplyTransferInput,
  type TransferLifecycleResult as ApplyTransferResult,
} from '../transfers/transfer-lifecycle.service';
