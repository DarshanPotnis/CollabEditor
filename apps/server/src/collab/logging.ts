/**
 * Structured logging for the collab lifecycle. Every line carries the project
 * id so a session can be followed end to end.
 */
import type { Extension } from '@hocuspocus/server';
import type { Logger } from '../lib/logger.js';

export function createCollabLogging(logger: Logger): Extension {
  return {
    connected({ documentName, socketId }) {
      logger.info({ projectId: documentName, socketId }, 'collab connected');
      return Promise.resolve();
    },

    onDisconnect({ documentName, socketId, clientsCount }) {
      logger.info({ projectId: documentName, socketId, clientsCount }, 'collab disconnected');
      return Promise.resolve();
    },

    afterLoadDocument({ documentName, document }) {
      logger.info(
        { projectId: documentName, nodes: document.getMap('nodes').size },
        'collab document loaded',
      );
      return Promise.resolve();
    },

    afterStoreDocument({ documentName, clientsCount }) {
      logger.debug({ projectId: documentName, clientsCount }, 'collab document stored');
      return Promise.resolve();
    },
  };
}
