import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

type AttendanceBatchItemLike = {
  childId?: string;
  date?: string;
};

@ValidatorConstraint({ name: 'UniqueChildDateInBatch', async: false })
export class UniqueChildDateInBatchConstraint
  implements ValidatorConstraintInterface
{
  validate(records: AttendanceBatchItemLike[]): boolean {
    if (!Array.isArray(records)) {
      return false;
    }

    const seen = new Set<string>();
    for (const record of records) {
      if (!record?.childId || !record?.date) {
        continue;
      }
      const key = `${record.childId}|${record.date.slice(0, 10)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
    }
    return true;
  }

  defaultMessage(): string {
    return 'Duplicate childId + date combinations are not allowed in the same batch';
  }
}

export function UniqueChildDateInBatch(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: UniqueChildDateInBatchConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'IsAttendanceDate', async: false })
export class IsAttendanceDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    // Disallow far-future attendance (more than 1 day ahead)
    const tomorrow = new Date();
    tomorrow.setHours(23, 59, 59, 999);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return date.getTime() <= tomorrow.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid date not far in the future`;
  }
}

export function IsAttendanceDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsAttendanceDateConstraint,
    });
  };
}
