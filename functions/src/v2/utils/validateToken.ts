const isTokenValid = (expiresIn: number) => {
  const expDateMs = expiresIn || null;
  if (expDateMs) {
    const expDateString = Number(`${expDateMs}`.padEnd(13, "0"));
    const expDate = new Date(expDateString);
    return expDate.getTime() > Date.now();
  }
  return false;
};

export default isTokenValid;
