var SamsungRemote = require('samsung-remote');
var inherits = require('util').inherits;
var Service, Characteristic, VolumeCharacteristic, ChannelCharacteristic, KeyCharacteristic;

/**
 * Just a little helper that guarantees that the callback function is only callable once.
 *
 * @param {Function} callback The actual callback.
 */
function DisposableCallback(callback) {
	var _callback = callback
	return function() {
		_callback.apply(this, arguments)
		_callback = function() {
			console.log('Warning: Attempt to call disposable callback twice.')
		}
	}
}

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;

	// we can only do this after we receive the homebridge API object
	makeVolumeCharacteristic();
	makeChannelCharacteristic();
	makeKeyCharacteristic();

	homebridge.registerAccessory("homebridge-samsungtv", "SamsungTV", SamsungTvAccessory);
};

//
// SoundTouch Accessory
//

function SamsungTvAccessory(log, config) {
	this.log = log;
	this.config = config;
	this.name = config["name"];
	this.ip_address = config["ip_address"];
	this.send_delay = config["send_delay"] || 400;
	this.atv_address = config["atv_address"];

	if (!this.ip_address) throw new Error("You must provide a config value for 'ip_address'.");

	this.remote = new SamsungRemote({
		ip: this.ip_address // required: IP address of your Samsung Smart TV
	});

	this.isSendingSequence = false;

	// The channel value can not be accessed on the tv
	// if the normal remote is used to change the channel
	// the value will not be updated therefore
	this.channel = 1;

	this.service = new Service.Switch(this.name);

	this.service
		.getCharacteristic(Characteristic.On)
		.on('get', this._getOn.bind(this))
		.on('set', this._setOn.bind(this));

	this.service
		.addCharacteristic(VolumeCharacteristic)
		.on('get', this._getVolume.bind(this))
		.on('set', this._setVolume.bind(this));

	this.service
		.addCharacteristic(ChannelCharacteristic)
		.on('get', this._getChannel.bind(this))
		.on('set', this._setChannel.bind(this));

	this.service
		.addCharacteristic(KeyCharacteristic)
		.on('get', this._getKey.bind(this))
		.on('set', this._setKey.bind(this));
}

SamsungTvAccessory.prototype.getInformationService = function() {
	var informationService = new Service.AccessoryInformation();
	informationService
		.setCharacteristic(Characteristic.Name, this.name)
		.setCharacteristic(Characteristic.Manufacturer, 'Samsung TV')
		.setCharacteristic(Characteristic.Model, '1.0.0')
		.setCharacteristic(Characteristic.SerialNumber, this.ip_address);
	return informationService;
};

SamsungTvAccessory.prototype.getServices = function() {
	return [this.service, this.getInformationService()];
};

SamsungTvAccessory.prototype._getOn = function(callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)
	this.remote.isAlive(function(err) {
		if (err) {
			accessory.log.debug('TV is offline: %s', err);
			cb(null, false);
		} else {
			accessory.log.debug('TV is alive.');
			cb(null, true);
		}
	});
};

SamsungTvAccessory.prototype._setOn = function(on, callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)
	if (on) {
		if (!this.atv_address){
			this.remote.send('KEY_POWERON', function(err) {
				if (err) {
					accessory.log.debug('Could not turn TV on: %s', err);
					cb(new Error(err));
				} else {
					accessory.log.debug('TV successfully turnen on');
					cb(null);
				}
			});
		}else{
			var net = require('net');
			var client = new net.Socket();
			client.connect(7000, this.atv_address, function() {
				accessory.log.debug('Connected to Apple TV');
				client.write('POST /play HTTP/1.1\r\n');
				client.write('Content-Length: 92\r\n');
				client.write('User-Agent: MediaControl/1.0\r\n\r\n');
				client.write('Content-Location: https://github.com/fafoulon/video/raw/master/black.mp4\r\n');
				client.write('Start-Position: 0\r\n');
			});

			client.on('data', function(data) {
				if(data.indexOf('200 OK') > -1) {
					accessory.log.debug('Code 200 Received');
					setTimeout(function(){ client.destroy(); }, 3000);
					cb(null);
				}else{
					accessory.log.debug('Error with Data received: ' + data);
					client.destroy();
					cb(new Error('Error from Apple TV'));
				}
			});

			client.on('close', function() {
				accessory.log.debug('Connection with Apple TV closed');
			});
		}
	} else {
		this.remote.send('KEY_POWEROFF', function(err) {
			if (err) {
				accessory.log.debug('Could not turn TV off: %s', err);
				cb(new Error(err));
			} else {
				accessory.log.debug('TV successfully turnen off');
				cb(null);
			}
		});
	}
};

SamsungTvAccessory.prototype._getVolume = function(callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)
	cb(null, 25);
};

SamsungTvAccessory.prototype._setVolume = function(volume, callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)

	// Dismiss the request when another key sequence sending
	if (this.isSendingSequence) {
		cb(null);
		this.log.debug('Cannot send volume change by %s while sending other key sequence.', volume);
		return;
	}
	this.isSendingSequence = true;

	// When volume is 0, mute will be toggled
	if (volume === 0) {
		accessory.remote.send('KEY_MUTE', function(err) {
			if (err) {
				accessory.isSendingSequence = false;
				cb(new Error(err));
				accessory.log.error('Could not send mute key: %s', err);
				return;
			}
			accessory.log.debug('Finished sending mute key.');
			accessory.isSendingSequence = false;
			cb(null);
		});
		return;
	}

	this.log.debug('Changing volume by %s.', volume);

	var volumeKey = volume > 0 ? 'KEY_VOLUP' : 'KEY_VOLDOWN';
	var absVolume = Math.abs(volume);

	function sendKey(index) {
		if (index > 0) {
			accessory.remote.send(volumeKey, function(err) {
				if (err) {
					accessory.isSendingSequence = false;
					callback(new Error(err));
					accessory.log.error('Could not send volume key %s: %s', volumeKey, err);
					return;
				}
				// Send the next key after the specified delay
				setTimeout(function() {
					sendKey(--index)
				}, accessory.send_delay);
			});
			return;
		}
		accessory.log.debug('Finished changing volume by %s.', volume);
		accessory.isSendingSequence = false;
		cb(null);
	}
	sendKey(absVolume);
};


SamsungTvAccessory.prototype._getChannel = function(callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)

	cb(null, accessory.channel);
};

SamsungTvAccessory.prototype._setChannel = function(channel, callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)

	// Dismiss the request when another key sequence sending
	if (this.isSendingSequence) {
		cb(null);
		this.log.debug('Cannot send channel %s while sending other key sequence.', channel);
		return;
	}
	this.isSendingSequence = true;
	this.log.debug('Sending channel %s.', channel);

	var channelInt = parseInt(channel, 10);
	if (isNaN(channelInt) || channelInt < 1 || channelInt > 9999) {
		cb(new Error('Invalid channel "' + channel + '"'));
		this.log.error('Invalid channel "%s".', channel);
		return;
	}

	var chStr = channelInt.toString(),
		keys = [];
	for (var i = 0, j = chStr.length; i < j; ++i) {
		keys.push('KEY_' + chStr[i]);
	}
	// Add the enter key to the end
	keys.push('KEY_ENTER');

	function sendKey(index) {
		if (index < keys.length) {
			accessory.log.debug('Sending channel key %s.', keys[index]);
			accessory.remote.send(keys[index], function(err) {
				if (err) {
					accessory.isSendingSequence = false;
					cb(new Error(err));
					accessory.log.error('Could not send channel key %s: %s', keys[index], err);
					return;
				}
				
				// Send the next key after the specified delay
				setTimeout(function() {
					sendKey(++index)
				}, accessory.send_delay);
			});
			return;
		}
		accessory.log.debug('Finished sending channel %s.', channel);
		accessory.isSendingSequence = false;
		accessory.channel = channel;
		cb(null);
	}
	sendKey(0)
};

SamsungTvAccessory.prototype._getKey = function(callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)

	cb(null, accessory.key);
};

SamsungTvAccessory.prototype._setKey = function(key, callback) {
	var accessory = this;
	var cb = DisposableCallback(callback)

	// Dismiss the request when a key sequence is sending
	if (this.isSendingSequence) {
		cb(null);
		this.log.debug('Cannot send key %s while sending a key sequence.', key);
		return;
	}
	this.isSendingSequence = true;
	this.log.debug('Sending key %s.', key);

	accessory.remote.send('KEY_' + key.toUpperCase(), function(err) {
		if (err) {
			accessory.isSendingSequence = false;
			cb(new Error(err));
			accessory.log.error('Could not send key %s: %s', key, err);
			return;
		}
		accessory.log.debug('Finished sending key %s.', key);
		accessory.isSendingSequence = false;
		accessory.key = key;
		cb(null);
	});
};

/**
 * Custom characteristic for volume
 *
 * @return {Characteristic} The volume characteristic
 */
function makeVolumeCharacteristic() {

	VolumeCharacteristic = function() {
		Characteristic.call(this, 'Volume', '91288267-5678-49B2-8D22-F57BE995AA00');
		this.setProps({
			format: Characteristic.Formats.INT,
			unit: Characteristic.Units.PERCENTAGE,
			maxValue: 10,
			minValue: -10,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		//this.value = this.getDefaultValue();
		this.value = 1;
	};

	inherits(VolumeCharacteristic, Characteristic);
}

/**
 * Custom characteristic for channel
 *
 * @return {Characteristic} The channel characteristic
 */
function makeChannelCharacteristic() {

	ChannelCharacteristic = function () {
		Characteristic.call(this, 'Channel', '212131F4-2E14-4FF4-AE13-C97C3232499D');
		this.setProps({
			format: Characteristic.Formats.STRING,
			unit: Characteristic.Units.NONE,
			//maxValue: 9999,
			//minValue: 1,
			//minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		//this.value = this.getDefaultValue();
		this.value = "1";
	};

	inherits(ChannelCharacteristic, Characteristic);
}

/**
 * Custom characteristic for any key
 * @see(https://github.com/natalan/samsung-remote) The key can be any remote key without the KEY_ at the beginning (e.g. MENU)
 *
 * @return {Characteristic} The key characteristic
 */
function makeKeyCharacteristic() {

	KeyCharacteristic = function() {
		Characteristic.call(this, 'Key', '2A6FD4DE-8103-4E58-BDAC-25835CD006BD');
		this.setProps({
			format: Characteristic.Formats.STRING,
			unit: Characteristic.Units.NONE,
			//maxValue: 10,
			//minValue: -10,
			//minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		//this.value = this.getDefaultValue();
		this.value = "TV";
	};

	inherits(KeyCharacteristic, Characteristic);
}