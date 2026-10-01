// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct BackgroundState(tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
async fn begin_background_work(
    label: String,
    #[cfg(target_os = "android")] state: tauri::State<'_, BackgroundState>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    state.0.run_mobile_plugin::<serde_json::Value>("begin", serde_json::json!({ "label": label }))
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "android"))]
    let _ = label;
    Ok(())
}

#[tauri::command]
async fn end_background_work(
    #[cfg(target_os = "android")] state: tauri::State<'_, BackgroundState>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    state.0.run_mobile_plugin::<serde_json::Value>("end", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri::plugin::Builder::<tauri::Wry>::new("background")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.atarq.narrate", "BackgroundPlugin")?;
            app.manage(BackgroundState(handle));
            Ok(())
        }).build());
    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, begin_background_work, end_background_work])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
