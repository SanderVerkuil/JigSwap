export interface DomainEvent {
  readonly name: string;
  readonly occurredAt: Date;
}

export type DomainEventOf<TName extends string, TPayload> = DomainEvent & {
  readonly name: TName;
} & Readonly<TPayload>;
