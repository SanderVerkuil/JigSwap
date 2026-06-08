// The concrete systemClock is an adapter; only the contract lives in the domain.
export interface Clock {
  now(): Date;
}
