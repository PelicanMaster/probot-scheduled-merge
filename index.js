const scheduler = require('node-schedule');

module.exports = app => {
	console.log(`Probot-cron started`);
	let github = await robot.auth();

	console.log(`Adding 'installation' hook...`);
	robot.on('installation.created', context => {

	});

	robot.on('installation.deleted', context => {

	});
}

