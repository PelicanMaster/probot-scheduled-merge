const scheduler = require('node-schedule');
const yaml = require('js-yaml');

const defaultConfig = {
	cron: '* * * * * 7'
};

let repositories = [];

async function getConfig (repository, api) {
	let config = null;

	try {
		let configFile = await api.repos.getContent({
			repo: repository.name,
			owner: repository.owner.login,
			path: '.github/scheduled-merge.yml'
	    });

		if (configFile) {
			let content = Buffer.from(configFile.data.content, 'base64');
			config = yaml.safeLoad(content.toString());
		}
	} catch (error) {
		if (error.code != 404) {
			throw error;
		}
	}

	return config || defaultConfig;
}

async function addRepository (repository, api) {
	let config = await getConfig(repository, api);
	let schedule = scheduler.scheduleJob(config.cron, () => executeSchedule(repository, api));

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
