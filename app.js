require('dotenv').config();
const Gt06 = require('./gt06');
const Mqtt = require('mqtt');
const net = require('net');

const serverPort = process.env.GT06_SERVER_PORT || 64459;
const rootTopic = process.env.MQTT_ROOT_TOPIC || 'gt06/';
const brokerUrl = process.env.MQTT_BROKER_URL || 'localhost';
const brokerPort = process.env.MQTT_BROKER_PORT || 1883;
const brokerUser = process.env.MQTT_BROKER_USER || 'user';
const brokerPasswd = process.env.MQTT_BROKER_PASSWD || 'passwd';

var mqttClient = Mqtt.connect(
    {
        host: brokerUrl,
        port: brokerPort,
        username: brokerUser,
        password: brokerPasswd
    });

var server = net.createServer((client) => {
    var gt06 = new Gt06();
    console.log('client connected');

    client.on('close', () => {
        console.log('client disconnected');
    });

    client.on('data', (data) => {
        try {
            gt06.parse(data);
        }
        catch (e) {
            console.log('err', e);
            return;
        }
        console.log(gt06);
        if (gt06.expectsResponse) {
            client.write(gt06.responseMsg);
        }
        mqttClient.publish(rootTopic + gt06.imei + '/pos', JSON.stringify(gt06));
    });
});

server.listen(serverPort, () => {
    console.log('started server on port:', serverPort);
});

