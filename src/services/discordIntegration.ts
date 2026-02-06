import axios from 'axios';
import { config } from '../config';
import { logger } from '../lib/logger';

/**
 * Discord integration helpers.
 * All Discord interactions go through the discord-service HTTP API,
 * never directly to the Discord API.
 */

interface ChannelResponse {
  channelId: string;
  messageId?: string;
}

/**
 * Create a dispute channel via discord-service
 */
export async function createDisputeChannel(
  disputeId: string,
  userDiscordId: string,
  username: string,
  submissionId: string
): Promise<ChannelResponse | null> {
  if (!config.discordServiceUrl) {
    logger.warn('DISCORD_SERVICE_URL not configured, skipping dispute channel creation');
    return null;
  }

  try {
    const response = await axios.post<ChannelResponse>(
      `${config.discordServiceUrl}/channels/dispute`,
      {
        disputeId,
        userDiscordId,
        username,
        submissionId,
      },
      { timeout: 10000 }
    );
    logger.info({ disputeId, channelId: response.data.channelId }, 'Dispute channel created');
    return response.data;
  } catch (error) {
    logger.error({ disputeId, error }, 'Failed to create dispute channel via discord-service');
    return null;
  }
}

/**
 * Create a support ticket channel via discord-service
 */
export async function createTicketChannel(
  ticketId: string,
  userDiscordId: string,
  username: string,
  subject: string
): Promise<ChannelResponse | null> {
  if (!config.discordServiceUrl) {
    logger.warn('DISCORD_SERVICE_URL not configured, skipping ticket channel creation');
    return null;
  }

  try {
    const response = await axios.post<ChannelResponse>(
      `${config.discordServiceUrl}/channels/ticket`,
      {
        ticketId,
        userDiscordId,
        username,
        subject,
      },
      { timeout: 10000 }
    );
    logger.info({ ticketId, channelId: response.data.channelId }, 'Ticket channel created');
    return response.data;
  } catch (error) {
    logger.error({ ticketId, error }, 'Failed to create ticket channel via discord-service');
    return null;
  }
}

/**
 * Close/delete a Discord channel via discord-service
 */
export async function closeChannel(channelId: string): Promise<boolean> {
  if (!config.discordServiceUrl) {
    logger.warn('DISCORD_SERVICE_URL not configured, skipping channel close');
    return false;
  }

  try {
    await axios.delete(
      `${config.discordServiceUrl}/channels/${channelId}`,
      { timeout: 10000 }
    );
    logger.info({ channelId }, 'Discord channel closed');
    return true;
  } catch (error) {
    logger.error({ channelId, error }, 'Failed to close Discord channel via discord-service');
    return false;
  }
}
