export function createUuidGenerator(start = 1) {
  let next = start;
  const initial = start;
  const generate = () => {
    const suffix = String(next).padStart(12, "0");
    next += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
  generate.reset = () => {
    next = initial;
  };
  return generate;
}
