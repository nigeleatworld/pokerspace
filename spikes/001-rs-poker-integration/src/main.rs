use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use rand::{SeedableRng, rngs::StdRng};
use rs_poker::arena::action::AgentAction;
use rs_poker::arena::cfr::{
    BudgetConfig, BudgetItem, CFRAgentBuilder, CFRState, ConfigurableActionConfig,
    ConfigurableActionGenerator, TraversalSet,
};
use rs_poker::arena::hand_estimator::UniformRandomEstimator;
use rs_poker::arena::agent::RandomAgentGenerator;
use rs_poker::arena::competition::SingleTableTournamentBuilder;
use rs_poker::arena::{Agent, AgentGenerator, GameState, GameStateBuilder, HoldemSimulationBuilder};
use rs_poker::core::{Hand, Rankable};

struct TimedAgent {
    inner: Box<dyn Agent>,
    samples: Arc<Mutex<Vec<Duration>>>,
}

#[async_trait]
impl Agent for TimedAgent {
    async fn act(&mut self, id: u128, game_state: &GameState) -> AgentAction {
        let started = Instant::now();
        let action = self.inner.act(id, game_state).await;
        self.samples.lock().unwrap().push(started.elapsed());
        action
    }

    fn name(&self) -> &str {
        self.inner.name()
    }

    fn historian(&self) -> Option<Box<dyn rs_poker::arena::Historian>> {
        self.inner.historian()
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let ranked = Hand::new_from_str("AsKsQsJsTs9d2c").unwrap();
    println!("evaluator seven-card category={:?}", ranked.rank().category());

    let game_state = GameStateBuilder::new()
        .num_players_with_stack(8, 100.0)
        .blinds(2.0, 1.0)
        .dealer_idx(0)
        .max_raises_per_round(Some(3))
        .build()
        .unwrap();
    let cfr_state = CFRState::new(game_state.clone());
    let traversal_set = TraversalSet::new(8);
    let samples = Arc::new(Mutex::new(Vec::new()));
    // The repository's documented nontrivial example budget: richer than the
    // 5-iteration/width-1 fallback, but still hard-capped at 100 ms per act.
    let budget = BudgetConfig(vec![
        BudgetItem::Deadline { millis: 100 },
        BudgetItem::PerDepthIterations {
            counts: vec![24, 3, 1],
            fallback: 1,
        },
        BudgetItem::MaxWidth {
            recursive_widths: vec![8, 1, 1],
        },
    ])
    .build();

    let agents: Vec<Box<dyn Agent>> = (0..8)
        .map(|seat| {
            let cfr = CFRAgentBuilder::<ConfigurableActionGenerator>::new()
                .name(format!("uniform-cfr-{seat}"))
                .player_idx(seat)
                .cfr_state(cfr_state.clone())
                .traversal_set(traversal_set.clone())
                .action_gen_config(ConfigurableActionConfig::default())
                .budget(budget.clone())
                // Crucial: default KnownHandsEstimator sees every opponent's true cards.
                .estimator(Arc::new(UniformRandomEstimator))
                .build();
            Box::new(TimedAgent {
                inner: Box::new(cfr),
                samples: samples.clone(),
            }) as Box<dyn Agent>
        })
        .collect();

    let started = Instant::now();
    let mut simulation = HoldemSimulationBuilder::default()
        .game_state(game_state)
        .agents(agents)
        .cfr_context(cfr_state.clone(), traversal_set, true)
        .build_with_rng(StdRng::seed_from_u64(0x5256_5252))
        .unwrap();
    simulation.run().await;
    let wall = started.elapsed();

    let mut ms: Vec<f64> = samples
        .lock()
        .unwrap()
        .iter()
        .map(|d| d.as_secs_f64() * 1000.0)
        .collect();
    ms.sort_by(f64::total_cmp);
    let count = ms.len();
    let mean = if count == 0 { 0.0 } else { ms.iter().sum::<f64>() / count as f64 };
    let p50 = ms.get(count.saturating_sub(1) / 2).copied().unwrap_or(0.0);
    let p95 = ms.get(((count as f64 * 0.95).ceil() as usize).saturating_sub(1)).copied().unwrap_or(0.0);
    let max = ms.last().copied().unwrap_or(0.0);

    println!("eight-player one-hand actions={count} wall_ms={:.3}", wall.as_secs_f64() * 1000.0);
    println!("decision_ms mean={mean:.3} p50={p50:.3} p95={p95:.3} max={max:.3}");
    println!("final_stacks={:?}", simulation.game_state.stacks);
    println!("cfr_nodes={}", cfr_state.node_count());

    let tournament_agents: Vec<Box<dyn AgentGenerator>> = (0..8)
        .map(|_| Box::<RandomAgentGenerator>::default() as Box<dyn AgentGenerator>)
        .collect();
    let tournament_state = GameStateBuilder::new()
        .num_players_with_stack(8, 20.0)
        .blinds(2.0, 1.0)
        .ante(0.25)
        .build()
        .unwrap();
    let tournament = SingleTableTournamentBuilder::default()
        .agent_generators(tournament_agents)
        .starting_game_state(tournament_state)
        .build(StdRng::seed_from_u64(0x5354_5408))
        .unwrap();
    let t0 = Instant::now();
    let results = tournament.run().await.unwrap();
    println!(
        "eight-player tournament places={:?} rounds={} wall_ms={:.3}",
        results.places(),
        results.rounds(),
        t0.elapsed().as_secs_f64() * 1000.0
    );
}
