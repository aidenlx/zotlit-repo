export const patch =
  <S extends object>(changes: Partial<S>) =>
  (state: S): S =>
    (Object.keys(changes) as (keyof S)[]).every(
      (key) => state[key] === changes[key],
    )
      ? state
      : { ...state, ...changes };

export const patchAt =
  <S extends object, K extends keyof S>(
    key: K,
    changes: Partial<S[K] & object>,
  ) =>
  (state: S): S => {
    const current = state[key] as S[K] & object;
    const next = patch(changes)(current);
    return next === current ? state : { ...state, [key]: next };
  };
