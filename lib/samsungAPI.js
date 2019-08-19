const remote = require('samsung-remote');
const wol = require('wake_on_lan');

const keyMapping = {
    0: 'KEY_REWIND',
    1: 'KEY_FF',
    2: 'KEY_FF',
    3: 'KEY_REWIND',
    4: 'KEY_UP',
    5: 'KEY_DOWN',
    6: 'KEY_LEFT',
    7: 'KEY_RIGHT',
    8: 'Enter',
    9: 'KEY_RETURN',
    10: 'KEY_HOME',
    11: 'KEY_PLAY',
    15: 'KEY_INFO'
};

const inputMapping = {
    1: 'KEY_TV',
    2: 'KEY_HDMI1',
    3: 'KEY_HDMI2',
    4: 'KEY_HDMI3',
    5: 'KEY_HDMI4'
};

class SamsungAPI {
    constructor(log, ipaddress, mac) {
        this.log = log;
        this.ip = ipaddress;
        this.mac = mac;
        this.state = false;

        this.remote = new remote({
            ip: this.ip,
            mac: this.mac
        });
    }

    isOn(callback) {
        this.remote.isAlive(err => {
            this.state = !err;
            callback(null, this.state);
        });
    }

    setState(on, callback) {
        if (on && this.state !== on && this.mac) {
            wol.wake(this.mac);
            callback(null);
        } else {
            if (this.state !== on) {
                this.sendCommand(on ? 'KEY_POWERON' : 'KEY_POWEROFF', callback);
            }
        }
    }

    changeVolume(volumeDown, callback) {
        this.sendCommand(volumeDown ? "KEY_VOLDOWN" : "KEY_VOLUP", callback);
    }

    setMute(callback) {
        this.sendCommand("KEY_MUTE", callback);
    }

    sendKey(key, callback) {
        this.sendCommand(keyMapping[key], callback);
    }

    setInput(input, callback) {
        this.sendCommand(inputMapping[input], callback);
    }

    sendCommand(command, callback) {
        this.remote.send(command, function (err) {
            if (err) {
                this.log.error('Failed sending %s', command, err);
                callback(err);
            } else {
                callback(null);
            }
        }.bind(this));
    }
}

module.exports = {
    SamsungAPI
};
