export type Ok<T> = {
  readonly isOk: true;
  readonly isErr: false;
  readonly value: T;
};
export type Err<E> = {
  readonly isOk: false;
  readonly isErr: true;
  readonly error: E;
};

export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ isOk: true, isErr: false, value });

export const err = <E>(error: E): Err<E> => ({
  isOk: false,
  isErr: true,
  error,
});

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> =>
  result.isOk;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  result.isErr;
