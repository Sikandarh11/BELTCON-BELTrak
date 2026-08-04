import {
  createAdministrator,
  createCustomsOfficer,
  createSupervisor,
  createTaggingOperator,
} from "../fixtures/userFixtures.mjs";
import { createBhsAdapterMock } from "../mocks/bhsAdapterMock.mjs";
import { createDeterministicClock } from "../mocks/clockMock.mjs";
import { createDatabaseMock } from "../mocks/databaseMock.mjs";
import { createGpioControllerMock } from "../mocks/gpioControllerMock.mjs";
import { createHbssAdapterMock } from "../mocks/hbssAdapterMock.mjs";
import { createMessageBusMock } from "../mocks/messageBusMock.mjs";
import { createRfidPrinterMock } from "../mocks/rfidPrinterMock.mjs";
import { createRfidReaderMock } from "../mocks/rfidReaderMock.mjs";
import { createUuidGenerator } from "../mocks/uuidMock.mjs";
import { createWebsocketEventCollector } from "../mocks/websocketMock.mjs";

export function createTestContext(testContext, options = {}) {
  const clock = createDeterministicClock(options.now);
  const uuid = createUuidGenerator();
  const database = createDatabaseMock(options.database);
  const bhs = createBhsAdapterMock(options.bhs);
  const hbss = createHbssAdapterMock(options.hbss);
  const rfidReader = createRfidReaderMock();
  const rfidPrinter = createRfidPrinterMock(options.rfidPrinter);
  const gpio = createGpioControllerMock(options.gpio);
  const messageBus = createMessageBusMock();
  const websocket = createWebsocketEventCollector();

  const context = {
    clock,
    uuid,
    database,
    bhs,
    hbss,
    rfidReader,
    rfidPrinter,
    gpio,
    messageBus,
    websocket,
    users: {
      administrator: createAdministrator(),
      taggingOperator: createTaggingOperator(),
      customsOfficer: createCustomsOfficer(),
      supervisor: createSupervisor(),
    },
    reset() {
      clock.reset();
      uuid.reset();
      database.reset();
      bhs.reset();
      hbss.reset();
      rfidReader.reset();
      rfidPrinter.reset();
      gpio.reset();
      messageBus.reset();
      websocket.reset();
    },
  };

  // Each test receives fresh data, and this hook guarantees cleanup even when
  // an assertion fails midway through the test.
  testContext?.after(() => context.reset());
  return context;
}
