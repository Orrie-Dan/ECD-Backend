/**
 * Convention for Prisma entity → response DTO mapping.
 * Place module mappers under: src/modules/<module>/mappers/
 */
export interface Mapper<Entity, Dto> {
  toDto(entity: Entity): Dto;
}

/**
 * Optional create/update mapping when request DTOs differ from Prisma input.
 */
export interface BidirectionalMapper<Entity, ResponseDto, CreateInput, UpdateInput = CreateInput>
  extends Mapper<Entity, ResponseDto> {
  toCreateInput?(dto: CreateInput): unknown;
  toUpdateInput?(dto: UpdateInput): unknown;
}
