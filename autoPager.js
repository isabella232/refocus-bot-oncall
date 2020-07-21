const { env } = require('./config.js');
const { compile } = require('handlebars');
const config = require('./config.js')[env];
const bdk = require('@salesforce/refocus-bdk')(config);
const pagerDuty = require('./pagerDuty.js');

/**
 * @param {string} name - name of function where error occurred.
 * @param {any} returnValue - value to be returned after logging.
 * @returns {any} - whatever was passed as the returnsValue param.
 */
function logInvalidargs(name, returnValue) {
  bdk.log.error(`Invalid args passed to function ${name}`);
  return returnValue;
}


/**
 * @param {number} roomId
 * @param {string} botId
 * @returns {Array<Incident>}
 */
async function getIncidentsForRoom(roomId, botId) {
  const incidents = await bdk.getBotData(roomId, botId, 'onCallIncidents');
  return incidents.body;
}

/**
 * @param {string} roomId
 * @returns {object} - teams to autoPage from room settings
 */
async function getTeamsToAutoPage(roomId) {
  const room = await bdk.getRoomById(roomId);
  const teams = room?.settings?.autoPageTeams;
  return teams;
}

/**
 * @param {Array<Incident>} incidentList - list of pager incidents that have already occurred.
 * @param {Array<Team>} teamsToPage - list of teams to autopage, from room settings.
 * @returns {Array<Team>} - list of teams from teamsToPage which have not been already paged.
 */
function removeAlreadyPagedTeams(incidentList, teamsToPage) {
  if (!incidentList?.length || !teamsToPage?.length)
    return logInvalidargs('removeAlreadyPagedTeams', []);
  const pagedTeams = incidentList.map((incident) => incident.service.id);
  return teamsToPage.filter((team) => !pagedTeams.includes(team.id));
}

/**
 * @param {Array<Team>} teams - list of teams to autopage, from room settings.
 * @param {string} severity - current severity of room.
 * @returns {Array<Team>} - array of teams which have the matching severity.
 */
function removeTeamsWithoutMatchingSeverity(teams, severity) {
  if (!teams?.length)
    return logInvalidargs('removeTeamsWithoutMatchingSeverity', []);
  teams.forEach((team) => {
    team.severities = team.severities.map((sev) => sev.toLowerCase());
  });
  return teams.filter((team) => team.severities.includes(severity));
}

/**
 *
 * @param {object} botData - onCallBotData object.
 * @returns {string} - message to be sent with page alert.
 */
async function getPagerAlertMessage(botData) {
  const { roomId, botId } = botData;
  const pageMessageBotData = await bdk.getBotData(roomId, botId, 'onCallBotTemplate');
  const pageMessage = pageMessageBotData.body?.[0]?.value;
  if (!pageMessage) return '';
  const caseVariables = JSON.parse(botData.value);
  const pageMessageTemplate = compile(pageMessage);
  const populatedPageMessage = pageMessageTemplate(caseVariables).toString();
  return populatedPageMessage;
}

/**
 *
 * @param {object} botData - onCallBotData object.
 * @param {string} severity - current severity of case.
 */
async function autoPageTeams(botData, severity) {
  const { roomId, botId } = botData;
  const incidentList = await getIncidentsForRoom(roomId, botId);
  const teamsToAutoPageFromRoomType = await getTeamsToAutoPage(roomId);
  if (!teamsToAutoPageFromRoomType?.length) return;
  const notYetPagedTeams = removeAlreadyPagedTeams(incidentList, teamsToAutoPageFromRoomType);
  const teamsToPage = removeTeamsWithoutMatchingSeverity(notYetPagedTeams, severity);
  const pageMessage = await getPagerAlertMessage(botData);
  bdk.log.info(`Room ${roomId} - auto paging ${JSON.stringify(teamsToPage)}`);
  teamsToPage.forEach((team) => {
    pagerDuty.triggerEvent(team.id, pageMessage, roomId);
  });
}

module.exports = {
  logInvalidargs,
  getIncidentsForRoom,
  getTeamsToAutoPage,
  removeAlreadyPagedTeams,
  removeTeamsWithoutMatchingSeverity,
  autoPageTeams,
};
