function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function cleanName(value) {
  if (!value) return "";
  return String(value).replace(/\s*\(?\d{4,}\)?\s*$/g, "").trim();
}

export function getFullName(user) {
  const firstName = pickFirst(
    user.firstName,
    user.first_name,
    user.firstname,
    user.givenName,
    user.given_name,
    user.profile?.firstName,
    user.profile?.first_name,
    user.personal?.firstName,
    user.personal?.first_name,
  );

  const lastName = pickFirst(
    user.lastName,
    user.last_name,
    user.lastname,
    user.surname,
    user.familyName,
    user.family_name,
    user.profile?.lastName,
    user.profile?.last_name,
    user.personal?.lastName,
    user.personal?.last_name,
  );

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return (
    cleanName(fullName) ||
    cleanName(user.fullName) ||
    cleanName(user.full_name) ||
    cleanName(user.realName) ||
    cleanName(user.real_name) ||
    cleanName(user.name) ||
    cleanName(user.publicNickname) ||
    `VID ${user.id}`
  );
}

export function getStaffPositionName(position) {
  const staffPosition = position?.staffPosition || position?.staff_position || position;
  const division = position?.division || position?.divisionStaffPosition?.division;

  const code = pickFirst(
    staffPosition?.shortName,
    staffPosition?.short_name,
    staffPosition?.name,
    staffPosition?.id,
    staffPosition?.code,
    position?.shortName,
    position?.short_name,
    position?.name,
    position?.id,
    position?.code,
  );

  const divisionId = pickFirst(
    division?.id,
    division?.code,
    position?.divisionId,
    position?.division_id,
  );

  if (code && divisionId && !String(code).toUpperCase().startsWith(`${String(divisionId).toUpperCase()}-`)) {
    return `${divisionId}-${code}`;
  }
  return code || null;
}

function getPositionDivisionId(position) {
  const division = position?.division || position?.divisionStaffPosition?.division;
  return String(
    pickFirst(
      division?.id,
      division?.code,
      position?.divisionId,
      position?.division_id,
      "",
    ),
  ).toUpperCase();
}

export function isThailandStaffPosition(position) {
  const divisionId = getPositionDivisionId(position);
  const positionName = String(getStaffPositionName(position) || "").toUpperCase();
  return divisionId === "TH" || positionName.startsWith("TH-");
}

export function buildSessionFromIvaoUser(user) {
  const allStaffPositions = Array.isArray(user.userStaffPositions) ? user.userStaffPositions : [];
  const thailandStaffPositions = allStaffPositions.filter(isThailandStaffPosition);
  const divisionId = String(user.divisionId || user.division?.id || "").toUpperCase() || null;
  const isIvaoStaff = Boolean(user.isStaff || allStaffPositions.length > 0);
  const isThailandStaff = Boolean(
    thailandStaffPositions.length > 0 || (user.isStaff && divisionId === "TH"),
  );

  return {
    id: user.id,
    vid: String(user.id),
    name: getFullName(user),
    publicNickname: user.publicNickname || null,
    divisionId,
    countryId: user.countryId || user.country?.id || null,
    atcRating: user.rating?.atcRating?.shortName || null,
    pilotRating: user.rating?.pilotRating?.shortName || null,
    isIvaoStaff,
    isThailandStaff,
    role: isThailandStaff ? "STAFF" : "MEMBER",
    staffPositions: thailandStaffPositions.map(getStaffPositionName).filter(Boolean),
    createdAt: new Date().toISOString(),
  };
}
