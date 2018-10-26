const scheduler = require('node-schedule');
const yaml = require('js-yaml');

const defaultConfig = { cron: '* * * * * 7' };
const POSITIVE_REACTIONS = ['+1'];
const NEGATIVE_REACTIONS = ['-1'];


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
	let pullRequests = await api.pullRequests.getAll({
		repo: repository.name,
		owner: repository.owner.login,
		state: 'open'
	});

	if (pullRequests.data && pullRequests.data.length > 0) {
		let scores = [];
		
		for (let pullRequest of pullRequests.data) {
			let reactions = await api.reactions.getForIssue({
				repo: repository.name,
				owner: repository.owner.login,
				number: pullRequest.number
			});

			let score = reactions.data.reduce((total, reaction) => {
				if (POSITIVE_REACTIONS.includes(reaction.content)) {
					return total + 1;
				} else if (NEGATIVE_REACTIONS.includes(reaction.content)) {
					return total - 1;
				}

				return total;
			}, 0);

			for (let reaction of reactions.data) {
				await api.reactions.delete({
					reaction_id: reaction.id,
					headers: {
						accept: 'application/vnd.github.squirrel-girl-preview+json'
					}
				});
			}

			scores.push({ pullRequest, score });
		};

		scores.sort((a, b) => a.score - b.score);

		let pullRequestToMerge = scores.pop().pullRequest;
		await api.pullRequests.merge({
			repo: repository.name,
			owner: repository.owner.login,
			number: pullRequestToMerge.number
		});

		for (let score of scores) {
			await api.pullRequests.update({
				repo: repository.name,
				owner: repository.owner.login,
				number: score.pullRequest.number,
				state: 'closed'
			});
		}
	}
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
