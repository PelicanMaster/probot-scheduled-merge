const scheduler = require('node-schedule');

let repositories = [];

function addRepository (repository, api) {
	// TODO: Get repo config
	let schedule = scheduler.scheduleJob({ second: 1 }, () => executeSchedule(repository, api));
	repositories.push({ repository, schedule });
}

function removeRepository (repository) {
	let index = repositories.findIndex(r => r.repository.id === repository.id);

	if (index > -1) {
		repositories[index].schedule.cancel();
		repositories.splice(index, 1);
	}
}

async function executeSchedule (repository, api) {
	console.log(`I run on ${repository.name} at ${new Date()}`);
}

module.exports = async robot => {
	console.log(`Probot-cron started`);
	let github = await robot.auth();

	console.log(`Adding 'installation' hook...`);
	robot.on('installation.created', context => {
		context.payload.repositories.forEach(addRepository);
	});

	robot.on('installation.deleted', context => {
		context.payload.repositories.forEach(removeRepository);
	});

	console.log(`Rescheduling on older installations...`);
	let { data } = await github.apps.getInstallations();

	data.forEach(async ({ id }) => {
		let installation = await robot.auth(id),
			{ data } = await installation.apps.getInstallationRepositories();

		data.repositories.forEach(repository => addRepository(repository, installation));
	});
}
