// get more info about the protocol from:
// https://www.traccar.org/protocols/
// https://dl.dropboxusercontent.com/s/sqtkulcj51zkria/GT06_GPS_Tracker_Communication_Protocol_v1.8.1.pdf
const getCrc16 = require('./crc16');
module.exports = Gt06 = function () {
    this.msgBufferRaw = new Array();
    this.msgBuffer = new Array();
    this.imei = null;
}

Gt06.prototype.parse = function (data) {
    this.msgBufferRaw.length = 0;
    const parsed = { expectsResonce: false };

    if (!checkHeader(data)) {
        throw { error: 'unknown message header', header: data.slice(0, 2) };
    }

    this.sliceMsgsInBuff(data);
    this.msgBufferRaw.forEach((msg, idx) => {
        switch (selectEvent(msg).number) {
            case 0x01: // login message
                Object.assign(parsed, parseLogin(msg));
                parsed.imei = parsed.imei;
                parsed.expectsResonce = true;
                parsed.responseMsg = createResponse(msg);
                break;
            case 0x12: // location message
                Object.assign(parsed, parseLocation(msg));
                break;
            case 0x13: // status message
                Object.assign(parsed, parseStatus(msg));
                parsed.expectsResonce = true;
                parsed.responseMsg = createResponse(msg);
                break;
            // case 0x15:
            //     //parseLocation(msg);
            //     break;
            // case 0x16:
            //     result = parseAlarm(msg);
            //     break;
            // case 0x1A:
            //     //parseLocation(msg);
            //     break;
            // case 0x80:
            //     //parseLocation(msg);
            //     break;
            default:
                throw {
                    error: 'unknown message type',
                    event: selectEvent(msg)
                };
                break;
        }
        parsed.event = selectEvent(msg);
        if (idx === 0) {
            Object.assign(this, parsed);
        } else {
            this.msgBuffer.push(parsed);
        }
    });
}

function checkHeader(data) {
    let header = data.slice(0, 2);
    if (!header.equals(Buffer.from('7878', 'hex'))) {
        return false;
    }
    return true;
}

function selectEvent(data) {
    let eventStr = 'unknown';
    switch (data[3]) {
        case 0x01:
            eventStr = 'login';
            break;
        case 0x12:
            eventStr = 'location';
            break;
        case 0x13:
            eventStr = 'status';
            break;
        case 0x16:
            eventStr = 'alarm';
            break;
        default:
            eventStr = 'unknown';
            break;
    }
    return { number: data[3], string: eventStr };
}

function parseLogin(data) {
    return {
        imei: parseInt(data.slice(4, 12).toString('hex'), 10),
        serialNumber: data.readUInt16BE(12),
        // errorCheck: data.readUInt16BE(14)
    };
}

function parseStatus(data) {
    let statusInfo = data.slice(4, 9);
    let terminalInfo = statusInfo.slice(0, 1).readUInt8(0);
    let voltageLevel = statusInfo.slice(1, 2).readUInt8(0);
    let gsmSigStrength = statusInfo.slice(2, 3).readUInt8(0);

    let alarm = (terminalInfo & 0x38) >> 3;
    let alarmType = 'normal';
    switch (alarm) {
        case 1:
            alarmType = 'shock'
            break;
        case 2:
            alarmType = 'power cut'
            break;
        case 3:
            alarmType = 'low battery'
            break;
        case 4:
            alarmType = 'sos'
            break;
        default:
            alarmType = 'normal';
            break;
    }

    let termObj = {
        status: Boolean(terminalInfo & 0x01),
        ignition: Boolean(terminalInfo & 0x02),
        charging: Boolean(terminalInfo & 0x04),
        alarmType: alarmType,
        gpsTracking: Boolean(terminalInfo & 0x40),
        relayState: Boolean(terminalInfo & 0x80)
    }

    let voltageLevelStr = 'no power (shutting down)'
    switch (voltageLevel) {
        case 1:
            voltageLevelStr = 'extremely low battery'
            break;
        case 2:
            voltageLevelStr = 'very low battery (low battery alarm)'
            break;
        case 3:
            voltageLevelStr = 'low battery (can be used normally)'
            break;
        case 4:
            voltageLevelStr = 'medium'
            break;
        case 5:
            voltageLevelStr = 'high'
            break;
        case 6:
            voltageLevelStr = 'very high'
            break;
        default:
            voltageLevelStr = 'no power (shutting down)'
            break;
    }

    let gsmSigStrengthStr = 'no signal'; // how shall it send without signal :-D
    switch (gsmSigStrength) {
        case 1:
            gsmSigStrengthStr = 'extremely weak signal';
            break;
        case 2:
            gsmSigStrengthStr = 'very weak signal';
            break;
        case 3:
            gsmSigStrengthStr = 'good signal';
            break;
        case 4:
            gsmSigStrengthStr = 'strong signal';
            break;
        default:
            gsmSigStrengthStr = 'no signal';
            break;
    }

    return {
        terminalInfo: termObj,
        voltageLevel: voltageLevelStr,
        gsmSigStrength: gsmSigStrengthStr
    };
}

function parseLocation(data) {
    let datasheet = {
        start_bit: data.readUInt16BE(0),
        protocol_length: data.readUInt8(2),
        protocol_number: data.readUInt8(3),
        datetime: data.slice(4, 10),
        quantity: data.readUInt8(10),
        lat: data.readUInt32BE(11),
        lon: data.readUInt32BE(15),
        speed: data.readUInt8(19),
        course: data.readUInt16BE(20),
        mcc: data.readUInt16BE(22),
        mnc: data.readUInt8(24),
        lac: data.readUInt16BE(25),
        cell_id: parseInt(data.slice(27, 30).toString('hex'), 16),
        serial_number: data.readUInt16BE(30),
        error_check: data.readUInt16BE(32)
    };

    let parsed = {
        datetime: parseDatetime(datasheet.datetime).toISOString(),
        satellites: (datasheet.quantity & 0xF0) >> 4,
        satellitesActive: (datasheet.quantity & 0x0F),
        lat: decodeGt06Lat(datasheet.lat, datasheet.course),
        lon: decodeGt06Lon(datasheet.lon, datasheet.course),
        speed: datasheet.speed,
        speed_unit: 'km/h',
        real_time_gps: Boolean(datasheet.course & 0x2000),
        gps_positioned: Boolean(datasheet.course & 0x1000),
        east_longitude: !Boolean(datasheet.course & 0x0800),
        north_latitude: Boolean(datasheet.course & 0x0400),
        course: (datasheet.course & 0x3FF),
        mcc: datasheet.mcc,
        mnc: datasheet.mnc,
        lac: datasheet.lac,
        cell_id: datasheet.cell_id,
        serial_number: datasheet.serial_number,
        error_check: datasheet.error_check
    };
    return parsed;
}

// not tested! not sent by my tracker
function parseAlarm(data) {
    let datasheet = {
        start_bit: data.readUInt16BE(0),
        protocol_length: data.readUInt8(2),
        protocol_number: data.readUInt8(3),
        datetime: data.slice(4, 10),
        quantity: data.readUInt8(10),
        lat: data.readUInt32BE(11),
        lon: data.readUInt32BE(15),
        speed: data.readUInt8(19),
        course: data.readUInt16BE(20),
        mcc: data.readUInt16BE(22),
        mnc: data.readUInt8(24),
        lac: data.readUInt16BE(25),
        cell_id: parseInt(data.slice(27, 30).toString('hex'), 16),
        terminal_information: data.readUInt8(31),
        voltage_level: data.readUInt8(32),
        gps_signal: data.readUInt8(33),
        alarm_lang: data.readUInt16BE(34),
        serial_number: data.readUInt16BE(36),
        error_check: data.readUInt16BE(38)
    };

    let parsed = {
        datetime: parseDatetime(datasheet.datetime),
        satellites: (datasheet.quantity & 0xF0) >> 4,
        satellitesActive: (datasheet.quantity & 0x0F),
        lat: decodeGt06Lat(datasheet.lat, datasheet.course),
        lon: decodeGt06Lon(datasheet.lon, datasheet.course),
        speed: datasheet.speed,
        speed_unit: 'km/h',
        real_time_gps: Boolean(datasheet.course & 0x2000),
        gps_positioned: Boolean(datasheet.course & 0x1000),
        east_longitude: !Boolean(datasheet.course & 0x0800),
        north_latitude: Boolean(datasheet.course & 0x0400),
        course: (datasheet.course & 0x3FF),
        mmc: datasheet.mnc,
        cell_id: datasheet.cell_id,
        terminal_information: datasheet.terminal_information,
        voltage_level: datasheet.voltage_level,
        gps_signal: datasheet.gps_signal,
        alarm_lang: datasheet.alarm_lang,
        serial_number: datasheet.serial_number,
        error_check: datasheet.error_check
    };
    return parsed;
}

function createResponse(data) {
    let respRaw = Buffer.from('787805FF0001d9dc0d0a', 'hex');
    // we put the protocol of the received message into the response message
    // at position byte 3 (0xFF in the raw message)
    respRaw[3] = data[3];
    appendCrc16(respRaw);
    return respRaw;
}

function parseDatetime(data) {
    return new Date(
        Date.UTC(
            data[0] + 2000, data[1] - 1, data[2], data[3], data[4], data[5]));
}

function decodeGt06Lat(lat, course) {
    var latitude = lat / 60.0 / 30000.0;
    if (!(course & 0x0400)) {
        latitude = -latitude;
    }
    return Math.round(latitude * 1000000) / 1000000;
}

function decodeGt06Lon(lon, course) {
    var longitude = lon / 60.0 / 30000.0;
    if (course & 0x0800) {
        longitude = -longitude;
    }
    return Math.round(longitude * 1000000) / 1000000;
}

function appendCrc16(data) {
    // write the crc16 at the 4th position from the right (2 bytes)
    // the last two bytes are the line ending
    data.writeUInt16BE(getCrc16(data.slice(2, 6)).readUInt16BE(0), data.length - 4);
}

Gt06.prototype.sliceMsgsInBuff = function (data) {
    let startPattern = new Buffer.from('7878', 'hex');
    let nextStart = data.indexOf(startPattern, 2);

    if (nextStart === -1) {
        this.msgBufferRaw.push(new Buffer.from(data));
        return this.msgBufferRaw.length;
    }
    this.msgBufferRaw.push(new Buffer.from(data.slice(0, nextStart)));
    let redMsgBuff = new Buffer.from(data.slice(nextStart));

    while (nextStart != -1) {
        nextStart = redMsgBuff.indexOf(startPattern, 2);
        if (nextStart === -1) {
            this.msgBufferRaw.push(new Buffer.from(redMsgBuff));
            break;
        }
        this.msgBufferRaw.push(new Buffer.from(redMsgBuff.slice(0, nextStart)));
        redMsgBuff = new Buffer.from(redMsgBuff.slice(nextStart));
    }
    return this.msgBufferRaw.length;
}