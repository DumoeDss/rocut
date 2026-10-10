extern crate self as effects;
#[path = "../../rust/crates/effects/src/liquid_object.rs"]
pub mod liquid_object;
#[path = "../../rust/crates/editor-api/src/liquid_object_params.rs"]
pub mod liquid_object_params;
#[path = "../../rust/crates/editor-api/src/liquid_object_transport.rs"]
pub mod liquid_object_transport;

fn main() {
    use liquid_object_transport::*;
    use std::io::{BufRead, Read, Write};
    let policy = liquid_object_transport_policy();
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "policy" {
        println!("{}", liquid_object_transport_policy_json());
        return;
    }
    if mode == "evaluate" {
        let mut input = String::new();
        std::io::stdin()
            .take(policy.max_request_json_bytes as u64 + 1)
            .read_to_string(&mut input)
            .unwrap();
        println!(
            "{}",
            liquid_object_params::evaluate_liquid_object_frame_json(input)
        );
        return;
    }
    let mut reader = std::io::stdin().lock();
    let mut line = String::new();
    let initial_bytes = (&mut reader)
        .take(policy.max_control_json_bytes as u64 + 1)
        .read_line(&mut line)
        .unwrap();
    if initial_bytes > policy.max_control_json_bytes {
        println!("{{\"version\":1,\"ok\":false}}");
        return;
    }
    let mut session = match LiquidObjectTransportSession::from_frame_json(line.trim_end()) {
        Ok(value) => value,
        Err(error) => {
            println!(
                "{}",
                serde_json::json!({"version":1,"ok":false,"error":error})
            );
            return;
        }
    };
    println!(
        "{}",
        serde_json::json!({"version":1,"ok":true,"policy":policy})
    );
    std::io::stdout().flush().unwrap();
    loop {
        line.clear();
        let bytes = (&mut reader)
            .take(policy.max_control_json_bytes as u64 + 1)
            .read_line(&mut line)
            .unwrap();
        if bytes == 0 {
            break;
        }
        let input = if bytes > policy.max_control_json_bytes {
            &line
        } else {
            line.trim_end()
        };
        println!("{}", session.command_json(input));
        std::io::stdout().flush().unwrap();
        if bytes > policy.max_control_json_bytes {
            break;
        }
    }
}
