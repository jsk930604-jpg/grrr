const fs = require("fs");
const path = require("path");
const { createLogger, format, transports } = require("winston");

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      if (stack) {
        return `${timestamp} [${level}] ${message}\n${stack}`;
      }
      return `${timestamp} [${level}] ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(logsDir, "app.log") })
  ]
});

module.exports = { logger };
