/**
 * Connect Lambda logs to AppEnlight
 *
 * Modified version of: https://github.com/SumoLogic/sumologic-aws-lambda/tree/master/cloudwatchlogs
 *
 * @author: Chris Moyer <cmoyer@aci.info>
 */


var https = require('https');
var zlib = require('zlib');

var VALID_LEVELS = [
	'DEBUG',
	'INFO',
	'WARN',
	'WARNING',
	'ERROR',
	'CRITICAL',
	'EXCEPTION',
	'FATAL',
];
var LOG_LEVEL_PATTERNS = [
	[ /debug: /, 'DEBUG'],
	[ /info: /, 'INFO'],
	[ /Error: /, 'ERROR'],
	[ /(START|END|REPORT) /, 'DEBUG'],
	[ /Process exited before completing request/, 'ERROR'],
];

exports.handler = function(event, context) {
	///////////////////////////////////////////////////////////////////////////////////////////////////////////
	// If running a self-hosted AppEnlight server, you must change the url.
	// Either way you must set the API Key
	///////////////////////////////////////////////////////////////////////////////////////////////////////////
	var options = {
		hostname: 'api.appenlight.com',
		path: '/api/logs?protocol_version=0.5',
		method: 'POST',
		headers: {
			'X-appenlight-api-key': '',
		},
	};
	var zippedInput = new Buffer(event.awslogs.data, 'base64');

	zlib.gunzip(zippedInput, function(e, buffer) {
		if (e) {
			console.log('Invalid Zipped data', e);
			context.done(e);
		}

		var awslogsData;
		try {
			awslogsData = JSON.parse(buffer.toString('ascii'));
		} catch (e){
			console.log('Invalid log data', buffer.toString('ascii'));
			return context.done('Failure parsing data', e);
		}


		if (awslogsData.messageType === 'CONTROL_MESSAGE') {
			console.log('Control message');
			return context.succeed('Success');
		}

		var logBatch = [];
		awslogsData.logEvents.forEach(function(val) {
			var logLevel = 'INFO';
			// Find the best matching log level
			LOG_LEVEL_PATTERNS.forEach(function(pattern){
				if(pattern[0].test(val.message)){
					logLevel = pattern[1];
				}
			});

			logBatch.push({
				log_level: logLevel,
				message: val.message,
				namespace: awslogsData.logGroup.split('/')[3],
				request_id: val.id,
				date: new Date(val.timestamp).toISOString(),
			});
		});
		console.log('Submit', logBatch);

		// Batch Submit data to AppEnlight
		var req = https.request(options, function(res) {
			var body = '';
			console.log('AppEnlight Status:', res.statusCode);
			res.setEncoding('utf8');
			res.on('data', function(chunk) { body += chunk; });
			res.on('end', function() {
				console.log('AppEnlight Response', body);
				context.succeed('Successfully processed HTTPS Response');
			});
		});

		req.on('error', function(e) {
			console.error('Error submitting to AppEnlight', e);
			context.done(e);
		});

		req.end(JSON.stringify(logBatch));
	});
};
