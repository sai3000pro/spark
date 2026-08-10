# Graph Report - .  (2026-08-10)

## Corpus Check
- Large corpus: 464 files · ~1,951,494 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3298 nodes · 6797 edges · 184 communities (145 shown, 39 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 328 edges (avg confidence: 0.78)
- Token cost: 445,497 input · 0 output

## Community Hubs (Navigation)
- Trip Specs & Geo Projection
- Multi-Provider Storage Fleet
- Splat Job & Ingest API
- Blob Sprite Build Pipeline
- Phone Handoff & QR Pairing
- Live Capture Server Tests
- Trip Data Read Boundary
- Synthetic Trip Generation
- ARKit Capture Binary Formats
- WebRTC Guided Recorder
- iOS Capture Record Schema
- iOS Capture View Model
- Capture Wire Protocol Clients
- Globe Point Cloud Rendering
- Capture Test Fixtures
- Detection Box Fusion
- Capture Frame Persistence
- iOS Capture Coordinator
- Devpost Product Screenshots
- Wi-Fi Mirroring Transport
- Uploaded Walk Construction
- Apple Framework Imports
- Capture State Machine
- Blob Mascot Animation Design
- Session Storage & Odometry
- Moment Pipeline Contract
- Theme Tokens & Brand Marks
- iOS Capture UI
- Tsconfig
- Python Capture Client
- Paper Globe Overlay
- CaptureView
- DEVPOST
- Session manager
- HeroBlobButton
- Test trajectory
- Verify pipeline
- Object catalog
- LedgerOverlay
- Labels
- AudioCapture
- BinaryEncoding
- Test pointcloud
- Landing
- Ui
- Server
- IPHONE LIDAR CAPTURE
- CaptureTransport
- NetworkProtocol
- Ws
- Export colmap
- GenerateRoutePath
- ARSessionController
- DebugView
- ExportSheet
- Package
- Package
- LiveScreen
- Page
- Bench
- RealMap
- Waterloo park
- REALTIME SPLAT PLAN
- MatrixSerializationTests
- Clock sync
- Gs3d
- DESIGN
- Splat batch
- Status
- Test intrinsics
- Process video
- WalkLedger
- SampleFrames
- LocationOneShot
- FrameSamplerTests
- Formats
- Route
- FieldMap
- ClockSync
- HeroAssets
- BlobSprites
- ARFrameExtraction
- IMPLEMENTATION STATUS
- README
- Semantics
- IntrinsicsScalingTests
- README
- 007 rls
- Package
- AlbumClient
- ViewQuality
- Stackt market
- Bake routes
- FORMAT SPEC
- GPS LOCATION CAPTURE HANDOVER
- Aurora wide 2400
- CaptureFileStore
- FileNaming
- Test validate
- Studio
- Icon
- TripSessionCard
- ObjectIndex
- Build landmask
- 006 splats storage sessions
- DESIGN
- GPS LOCATION CAPTURE HANDOVER
- 003 journeys and albums
- Splat tools
- Build capture frames
- BoundedFrameQueue
- ConnectionTester
- 005 pipeline
- Test formats
- LiveTripProvider
- 001 extensions and identity
- 002 social
- CloudLayer
- Odometry client
- Sky mask
- Layout
- Build icons
- 004 invites
- CaptureFormat
- Temporal splat phase0
- Page
- Keyframe
- Build map style
- Phone brush
- Phone brush2
- Splat progress
- Route
- Auth shim
- Run live studio
- Analytics
- Build compare specs
- Phone ultra
- WhatItDoes
- Copy maplibre worker
- Tag runs
- AGENTS
- Route
- Route
- Route
- Route
- ViewSwitch
- Next config
- 008 push tokens
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Package
- Init
- Phone room
- Queue capture full
- Queue outdoor
- Run food
- Eslint config
- Postcss config
- README
- Community 174
- Community 175
- Community 176
- Community 177
- TECHNIQUES
- Community 182
- Community 183

## God Nodes (most connected - your core abstractions)
1. `RunningServer` - 59 edges
2. `PhoneClient` - 57 edges
3. `CaptureViewModel` - 55 edges
4. `CodingKeys` - 49 edges
5. `CaptureCoordinator` - 47 edges
6. `Vec2` - 40 edges
7. `WiFiLaptopTransport` - 29 edges
8. `AudioCapture` - 28 edges
9. `CaptureView` - 27 edges
10. `ARSessionController` - 25 edges

## Surprising Connections (you probably didn't know these)
- `The desk globe (PocketGlobe / GlobeOverlay / paperGlobe)` --semantically_similar_to--> `/globe point-cloud Earth on three + R3F`  [INFERRED] [semantically similar]
  DESIGN.md → web/README.md
- `Gaussian-splat reconstruction pipeline (COLMAP then splat training)` --semantically_similar_to--> `Brush pipeline (COLMAP then optimize) — the workhorse`  [INFERRED] [semantically similar]
  DEVPOST.md → tools/video_intel/TECHNIQUES.md
- `Multi-pass in-browser object detector` --semantically_similar_to--> `lib/detector.ts multi-pass in-browser detector`  [INFERRED] [semantically similar]
  DEVPOST.md → web/README.md
- `npm run verify (pipeline invariant guardrail)` --semantically_similar_to--> `Swift CoreCheck (23 checks, cross-language golden)`  [INFERRED] [semantically similar]
  web/README.md → IPHONE_LIDAR_CAPTURE_TEST_REPORT.md
- `Coverage-triggered keyframe selector` --semantically_similar_to--> `lib/detect/viewQuality.ts (best angle scoring)`  [INFERRED] [semantically similar]
  REALTIME_SPLAT_PLAN.md → web/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Gauzensplat capture phase-gate ladder (Phases 0-7)** — implementation_status_phase0, implementation_status_phase1, implementation_status_phase2, implementation_status_phase3, implementation_status_phase4, implementation_status_phase5, implementation_status_phase6, implementation_status_phase7, gauzensplat_master_iphone_wifi_esp32_implementation_prompt_phase_gate_rule [EXTRACTED 1.00]
- **Progressive live-splat loop (coverage to keyframe to cadence to viewer)** — realtime_splat_plan_coverage_map, realtime_splat_plan_keyframe_selector, realtime_splat_plan_keyframe_wire_tag, realtime_splat_plan_liverconmanager, realtime_splat_plan_cadence_controller, realtime_splat_plan_live_splat_api, realtime_splat_plan_viewer_live_mode [EXTRACTED 1.00]
- **Validated splat-quality recipe (deblur, sky-mask, Brush, prune)** — tools_video_intel_techniques_deblur, tools_video_intel_techniques_sky_masking, tools_video_intel_techniques_brush_pipeline, tools_video_intel_techniques_prune, tools_video_intel_techniques_recommended_recipe [EXTRACTED 1.00]
- **Blob Companion Animation State Machine** — design_blob_sleep_cycle_strip_idle_sleep_loop, design_asking_question_wake_to_curious_transition, design_blob_jumping_jump_anticipation_apex_land_cycle, design_moreanimationssprites_emotion_state_set, design_moreanimationssprites_blob_companion_character [INFERRED 0.85]
- **Splat Viewer Control Surface (shared across landing mocks)** — design_landing_page_1_raw_point_cloud_controls, design_landing_page_2_cinematic_control_panel, design_landing_page_2_capture_clean_photo_action, design_landing_page_3_live_off_toggle, design_landing_page_4_reference_frame_dropdown [INFERRED 0.85]
- **Scene Understanding Overlay Stack (transcript + detections + reference frame)** — design_landing_page_2_transcript_panel, design_landing_page_4_object_detection_sidebar, design_landing_page_5_reference_frame_thumbnail_preview, design_landing_page_5_hovered_object_label_chip, design_landing_page_5_gaussian_splat_scene_rendering [INFERRED 0.85]
- **Spark Navigation Flow: Hero → Globe → Walk Map → Moment** — devpost1_landing_hero, devpost_secon_the_globe_screen, devpost_third_walk_hover_card, devpost_first_the_walk_map_replay, devpost_first_moment_flag_marker [INFERRED 0.85]
- **Capture-to-Kept Curation Pipeline (sieve, scoring, transparency)** — devpost_one_sieve_all_day, devpost_moment_scoring_signals, devpost_seen_weighed_kept_funnel, devpost_discards_stay_visible, devpost_detector_bench [EXTRACTED 1.00]
- **3D Scene Reconstruction & Viewing Stack (splats, point cloud, live session)** — devpost3_live_session_stream, devpost3_comfyui_3d_viewer, devpost2_gaussian_splat_viewer, devpost2_raw_ply_artifact, devpost2_2_hackathon_scene_reconstruction [INFERRED 0.85]
- **Aurora Hero Backplate Responsive Set (wide 1600/2400, tall 900/1350)** — web_public_hero_aurora_wide_1600_backplate, web_public_hero_aurora_wide_2400_backplate, web_public_hero_aurora_tall_900_backplate, web_public_hero_aurora_tall_1350_backplate [INFERRED 0.95]
- **Night Walk Keyart Triptych (mascot on a lit path at dusk)** — web_public_hero_keyart_hero_lamplight_keyart, web_public_hero_keyart_a_aurora_keyart, web_public_hero_keyart_b_longway_keyart, web_public_hero_robot_cutout_spark_mascot [INFERRED 0.85]
- **Spark Mascot Render Variants (painterly cutout, walk strip, in-scene flat)** — web_public_hero_robot_cutout_mascot_cutout, web_public_hero_blob_walk_walk_cycle_sprite_sheet, web_public_hero_keyart_hero_lamplight_keyart, web_public_hero_robot_cutout_spark_mascot [INFERRED 0.85]
- **Showcase Hackathon Mock Frame Set (build room, courtyard, meal, demo cloud, hero)** — web_public_mock_frames_sh_build_room_close_frame, web_public_mock_frames_sh_build_room_frame, web_public_mock_frames_sh_courtyard_meal_frame, web_public_mock_frames_sh_courtyard_frame, web_public_mock_frames_sh_demo_cloud_frame, web_public_mock_frames_showcase_wide_frame [INFERRED 0.85]
- **Spark Visual Identity: Dark Ground, Glowing Subject, Blurred Motion** — web_app_icon_concept_spark_glow_brand_mark, web_public_mock_frames_showcase_wide_concept_painterly_memory_aesthetic, web_public_mock_frames_sh_demo_cloud_concept_3d_reconstruction_preview [INFERRED 0.75]

## Communities (184 total, 39 thin omitted)

### Community 0 - "Trip Specs & Geo Projection"
Cohesion: 0.04
Nodes (81): cache, makeLngLatToLocal(), at(), defaultSeeds(), hashString(), TripSpec, RouteSegment, PlaceholderOptions (+73 more)

### Community 1 - "Multi-Provider Storage Fleet"
Cohesion: 0.05
Nodes (54): createFleet(), Fleet, archiveKey(), classOf(), deliveryKey(), detectionsKey(), EXT, keyframeKey() (+46 more)

### Community 2 - "Splat Job & Ingest API"
Cohesion: 0.05
Nodes (46): POST(), POST(), dynamic, GET(), NO_STORE, POST(), runtime, dynamic (+38 more)

### Community 3 - "Blob Sprite Build Pipeline"
Cohesion: 0.08
Nodes (57): CellName, CLIPS, ClipSpec, cutSheet(), DESIGN, err(), fail(), failures (+49 more)

### Community 4 - "Phone Handoff & QR Pairing"
Cohesion: 0.06
Nodes (49): RFC-1918, Ctx, dynamic, GET(), POST(), runtime, Ctx, dynamic (+41 more)

### Community 5 - "Live Capture Server Tests"
Cohesion: 0.09
Nodes (15): PhoneClient, Frame, synth_frames(), TestDashboard, TestConnection, mirror_session(), TestMirroring, _rss_kb() (+7 more)

### Community 6 - "Trip Data Read Boundary"
Cohesion: 0.09
Nodes (46): dynamic, GET(), knownTripId(), NO_STORE, Params, POST(), GET(), TripPage() (+38 more)

### Community 7 - "Synthetic Trip Generation"
Cohesion: 0.10
Nodes (47): RATES, buildAudioEvents(), buildKeywordHits(), buildStops(), buildTranscript(), buildTrip(), cache, contentFor() (+39 more)

### Community 8 - "ARKit Capture Binary Formats"
Cohesion: 0.07
Nodes (25): decode_confidence(), decode_depth(), encode_confidence(), encode_depth(), matrix_to_rows(), parse_transform(), ndarray, Parse a 4x4 camera-to-world transform (row-major). (+17 more)

### Community 9 - "WebRTC Guided Recorder"
Cohesion: 0.08
Nodes (36): fmt(), GuidedRecorder(), Props, dynamic, metadata, explain(), fmtMb(), Phase (+28 more)

### Community 10 - "iOS Capture Record Schema"
Cohesion: 0.04
Nodes (46): CodingKey, CodingKeys, appVersion, cameraIntrinsics, cameraTransform, cameraTransformModified, cameraTransformSource, cameraTransformStorage (+38 more)

### Community 11 - "iOS Capture View Model"
Cohesion: 0.08
Nodes (22): AnyCancellable, CaptureViewModel, .capturesDir, .health, .lastSessionURL, .sessionsIndexURL, .stats, .syncedSessionsURL (+14 more)

### Community 12 - "Capture Wire Protocol Clients"
Cohesion: 0.08
Nodes (30): sha256_hex(), Reference phone client for the live capture protocol. Shared by…, Reference odometry (ESP32) client for the live capture protocol. The real ESP32…, bulk_header(), check_protocol_version(), payload_relpath(), ProtocolError, Exception (+22 more)

### Community 13 - "Globe Point Cloud Rendering"
Cohesion: 0.08
Nodes (37): vec3ToGeo(), buildGlobeCloud(), buildStarField(), GlobeCloud, hexToRgb(), lerp(), mix(), Rgb (+29 more)

### Community 14 - "Capture Test Fixtures"
Cohesion: 0.08
Nodes (24): default_intrinsics(), _identity_transform(), make_synthetic_session(), ndarray, Path, Synthetic capture-session generator for tests and integration. Produces an on-…, Create a synthetic capture at ``root``. Camera moves +``step_m`` along world X…, _write_rgb() (+16 more)

### Community 15 - "Detection Box Fusion"
Cohesion: 0.10
Nodes (36): Box, boxArea(), clampBox(), Cluster, containment(), dropContained(), fuseBoxes(), FusedBox (+28 more)

### Community 16 - "Capture Frame Persistence"
Cohesion: 0.09
Nodes (25): Codable, Int, writeFrames(), Data, CaptureTrackingState, limited, normal, notAvailable (+17 more)

### Community 17 - "iOS Capture Coordinator"
Cohesion: 0.13
Nodes (21): AnyObject, CaptureState, CaptureCoordinator, .accepting, .currentState, .lastSessionURL, .sampleRateHz, QueuedFrame (+13 more)

### Community 18 - "Devpost Product Screenshots"
Cohesion: 0.08
Nodes (37): Global Nav: Albums / The Walk / Detector Bench / Mute, Spark Landing Hero ("The walk is over... The memory isn't."), Provenance Status Bar (site, coordinates, things remembered, discard record), "Step Into the Walk" Primary CTA, "Walk It Back" Scrolling Marquee Section Divider, Gaussian Splat Viewer — Alternate Camera Framing, Hackathon Table Scene Reconstruction (people, laptops, blue tablecloths), Capture Clean Photo Action (+29 more)

### Community 19 - "Wi-Fi Mirroring Transport"
Cohesion: 0.12
Nodes (22): Error, StateBox, .value, Any, Bool, Double, Int, String (+14 more)

### Community 20 - "Uploaded Walk Construction"
Cohesion: 0.09
Nodes (32): BuiltTrip, pathDistanceM(), BuiltTrip, promoteToMoment(), BBox, Detection, Trip, buildWalkFromDetections() (+24 more)

### Community 21 - "Apple Framework Imports"
Cohesion: 0.10
Nodes (15): ARKit, AVFoundation, Combine, CoreImage, CoreLocation, CoreVideo, Foundation, GauzensplatCaptureCore (+7 more)

### Community 22 - "Capture State Machine"
Cohesion: 0.10
Nodes (24): Equatable, CaptureAction, fail, finalizeSucceeded, preparationFailed, preparationSucceeded, reset, start (+16 more)

### Community 23 - "Blob Mascot Animation Design"
Cohesion: 0.08
Nodes (34): Asking Question Sprite Strip, Glowing Question Mark Affordance, Wake-to-Curious Transition (asleep -> drowsy -> alert -> raised-hand question), Blob Jumping Sprite Strip, Jump Cycle (question -> crouch anticipation -> ascent -> apex flare -> landing splash), Warm Glow / Sparkle Particle VFX Language, Blob Sleep-Cycle Strip, Idle Sleep Loop (5-frame breathing loop with escalating Z's) (+26 more)

### Community 24 - "Session Storage & Odometry"
Cohesion: 0.09
Nodes (11): OdometryStats, Path, Optional capture-location keys, only present when explicitly set. Omitted…, Persist an optional capture location from the begin_session handshake. Additive…, Store a bulk payload idempotently. Returns "stored" | "duplicate". Raises…, Persist the live-audio PCM format once (phone/audio.json). The transcription…, (Re)write metadata.jsonl sorted by frame_id (inspector-ready)., Return {str(frame_id): {payload_type: sha256}} of stored payloads. (+3 more)

### Community 25 - "Moment Pipeline Contract"
Cohesion: 0.11
Nodes (32): MomentSpec, MomentSpec, QAAnswer, buildKeyframes(), dedupeTriggers(), DetectionBin, discardReasonFor(), dwellSecondsIn() (+24 more)

### Community 26 - "Theme Tokens & Brand Marks"
Cohesion: 0.07
Nodes (28): SparkMark(), AURORA, AURORA_DEEP, BRAND, DUSK, EMBER, EMBER_DEEP, FAINT (+20 more)

### Community 27 - "iOS Capture UI"
Cohesion: 0.09
Nodes (26): Content, Image, CaptureView, .cameraDeniedOverlay, .confidenceText, .coordinatorRate, .depthText, .healthCard (+18 more)

### Community 28 - "Tsconfig"
Cohesion: 0.06
Nodes (30): dom, dom.iterable, esnext, Journey Moment Capture App, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts (+22 more)

### Community 29 - "Python Capture Client"
Cohesion: 0.10
Nodes (14): Frame, ClockSyncEstimator, Send one bulk payload; block for ACK. Returns 'stored'|'duplicate'. Records the…, Stream one PCM audio chunk (frame_id == chunk_seq). Best-effort: not recorded…, Mirror a fully-persisted frame: metadata + rgb + depth + confidence., Run end-of-session reconciliation, retrying missing/corrupt payloads., Exponential backoff reconnect + session resume., iter_frames() (+6 more)

### Community 30 - "Paper Globe Overlay"
Cohesion: 0.13
Nodes (25): Flight, FlightRig(), GlobeOverlay(), SpecimenPin(), useFitDistance(), BrassBezel(), cloudMemo, IdleSpin() (+17 more)

### Community 31 - "CaptureView"
Cohesion: 0.08
Nodes (19): ARAnchor, ARMeshAnchor, ARSCNView, ARSCNViewDelegate, CFTimeInterval, Float, ARCoverageView, Coordinator (+11 more)

### Community 32 - "DEVPOST"
Cohesion: 0.08
Nodes (30): Album view, Autonomous camera rover, Capture view (rover or phone), Gaussian-splat reconstruction pipeline (COLMAP then splat training), Map view with co-located moment stacking, Memory (explorable reconstruction + media artifact), Multi-pass in-browser object detector, Phone-side capture (iPhone LiDAR over Wi-Fi with ESP32) (+22 more)

### Community 33 - "Session manager"
Cohesion: 0.11
Nodes (17): ThreadingHTTPServer, Live diagnostic dashboard (terminal snapshot + minimal HTML)., render_html(), render_text(), snapshot(), lan_ip(), main(), make_server() (+9 more)

### Community 34 - "HeroBlobButton"
Cohesion: 0.12
Nodes (27): applyCell(), BlobState, cycleFrame(), frameOf(), Grab, HeroBlobButton(), Phase, ROAM (+19 more)

### Community 35 - "Test trajectory"
Cohesion: 0.14
Nodes (19): FrameMeta, Return the (x, y, z) translation column of a 4x4 transform., One parsed ``metadata.jsonl`` record. Mandatory fields are validated; unknown…, translation_of(), frame(), Phase 0: trajectory extraction and metrics tests., TestTrajectory, build_trajectory() (+11 more)

### Community 36 - "Verify pipeline"
Cohesion: 0.17
Nodes (27): mapPassBoxes(), planPasses(), bestViewpoint(), clampLat(), geoBounds(), geoToLocal(), localToGeo(), getActiveTrip() (+19 more)

### Community 37 - "Object catalog"
Cohesion: 0.12
Nodes (26): build(), cluster(), lift_box(), main(), make_detector(), _quat_to_R(), Return a run(image)->[{label,score,box}] closure. detr = facebook/detr-…, Group per-frame anchors of the same label into 3D instances (DBSCAN). (+18 more)

### Community 38 - "LedgerOverlay"
Cohesion: 0.12
Nodes (20): LibraryHeader(), Props, DayRidge(), FamilyBars(), LedgerOverlay(), listOut(), LogRow(), splatInk() (+12 more)

### Community 39 - "Labels"
Cohesion: 0.10
Nodes (24): FindPalette(), Props, Anchors(), ObjectSearch(), Props, Chip(), ConfidenceBar(), LabelDot() (+16 more)

### Community 40 - "AudioCapture"
Cohesion: 0.14
Nodes (14): AVAudioConverter, AVAudioFormat, AVAudioPCMBuffer, AudioCapture, .chunkBytes, .isAuthorized, Bool, Data (+6 more)

### Community 41 - "BinaryEncoding"
Cohesion: 0.09
Nodes (12): CryptoKit, BinaryEncoding, Data, Float, UInt8, Checksum, Data, String (+4 more)

### Community 42 - "Test pointcloud"
Cohesion: 0.15
Nodes (15): cloud_stats(), CloudStats, ndarray, Path, LiDAR depth -> world-space point cloud. Unprojection convention (ARKit…, Write an ASCII PLY point cloud (optionally with uint8 RGB)., Minimal ASCII-PLY reader returning (N,3) xyz — used by tests., Unproject one depth frame into world-space (N, 3) points. ``intrinsics_rgb`` is… (+7 more)

### Community 43 - "Landing"
Cohesion: 0.11
Nodes (20): Home(), ALBUM_LEFT, ALBUM_RIGHT, ALBUM_SPRAY, AlbumPrint, DotMatrix(), FIELD_NOTES, HERO_CYCLE (+12 more)

### Community 44 - "Ui"
Cohesion: 0.15
Nodes (18): DayBar(), Props, ResultRow(), inkButtonClass(), InkTag(), KeyframeImg(), LabelDot(), Meter() (+10 more)

### Community 45 - "Server"
Cohesion: 0.15
Nodes (7): BaseHTTPRequestHandler, Handler, OdometrySession, PhoneSession, One phone WebSocket connection's control + bulk-ingest loop., Exception, StorageError

### Community 46 - "IPHONE LIDAR CAPTURE"
Cohesion: 0.09
Nodes (26): v1 cadence budget pick (ReconConfig defaults), Measurement caveat (timings taken under GPU contention), S0.2 — wall-clock vs cadence knobs, Local-first mirroring order (disk before network), Source-of-truth principle (phone local storage authoritative), CaptureTransport abstraction requirement, Live Wi-Fi mirroring workflow on device, ARFrameExtractor (lightweight frame snapshot) (+18 more)

### Community 47 - "CaptureTransport"
Cohesion: 0.10
Nodes (15): CaptureTransport, OfflineTransport, ReconcileResult, .complete, Bool, Double, Int, URL (+7 more)

### Community 48 - "NetworkProtocol"
Cohesion: 0.15
Nodes (15): NetworkProtocol, PayloadIdentity, PayloadType, audio, confidence, depth, frameMetadata, rgb (+7 more)

### Community 49 - "Ws"
Cohesion: 0.15
Nodes (11): socket, accept_key(), Exception, Minimal, self-contained RFC 6455 WebSocket (server + client). Supports…, Return (opcode, data) for the next TEXT/BINARY message. Handles ping (auto-…, Open a client WebSocket connection (performs the RFC 6455 handshake)., A framed WebSocket connection over a blocking socket., ws_connect() (+3 more)

### Community 50 - "Export colmap"
Cohesion: 0.16
Nodes (22): _colored_points(), export_colmap(), main(), ndarray, Path, _quat_from_R(), COLMAP (Hamilton, w-first) quaternion from a 3x3 rotation matrix., Unproject LiDAR depth to metric world XYZ + RGB sampled from the frame. (+14 more)

### Community 51 - "GenerateRoutePath"
Cohesion: 0.12
Nodes (19): Props, Props, TripGeo, DwellPlan, ease(), generateRoutePath(), lerp(), Plan (+11 more)

### Community 52 - "ARSessionController"
Cohesion: 0.13
Nodes (11): AVAuthorizationStatus, DispatchSourceTimer, ARSessionController, Health, ARFrame, ARSession, Bool, Error (+3 more)

### Community 53 - "DebugView"
Cohesion: 0.13
Nodes (17): Hashable, Identifiable, PastSession, Date, Int, ContentUnavailableCompat, .body, HistoryView (+9 more)

### Community 54 - "ExportSheet"
Cohesion: 0.10
Nodes (15): App, GauzensplatCaptureApp, .body, .body, ExportManager, ExportSheet, Context, URL (+7 more)

### Community 55 - "Package"
Cohesion: 0.09
Nodes (23): @aws-sdk/client-s3, @huggingface/transformers, lenis, lucide-react, next, qrcode, @react-three/drei, @react-three/fiber (+15 more)

### Community 56 - "Package"
Cohesion: 0.09
Nodes (23): eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, tsx, @types/node, @types/qrcode, @types/react (+15 more)

### Community 57 - "LiveScreen"
Cohesion: 0.13
Nodes (15): AppLayout(), dynamic, LivePage(), metadata, LiveCounters(), LiveScreen(), PhoneHandoffSection(), Props (+7 more)

### Community 58 - "Page"
Cohesion: 0.11
Nodes (15): CapturePage(), CaptureState, fmtAgo(), fmtBytes(), fmtClock(), fmtInt(), LiveRun, OdometryDevice (+7 more)

### Community 59 - "Bench"
Cohesion: 0.13
Nodes (16): metadata, Bench(), Phase, QUALITY_ORDER, Bench, BenchClient(), outlineButtonClass(), passCountFor() (+8 more)

### Community 60 - "RealMap"
Cohesion: 0.11
Nodes (15): metadata, TripIndexPage(), Cluster, clusterByScreen(), pinBounds(), RealMap(), NavBrandSwitch(), NavTone (+7 more)

### Community 61 - "Waterloo park"
Cohesion: 0.13
Nodes (20): ActiveTrip, KEY, LiveCounters, LiveTripStatus, Store, LEG(), MOMENTS, P (+12 more)

### Community 62 - "REALTIME SPLAT PLAN"
Cohesion: 0.13
Nodes (22): S0.1 — train from ARKit poses, no COLMAP solve (PASS), S0.3 — warm-resume from prior ply not possible, S0.4 — serial-safe repeated Brush launches (PASS), Non-goals list (no web app, no Brush, no cloud, no auth), Explicit out-of-scope list (Brush/COLMAP/splatting/audio/rover), Future integration path (ARKit poses to Brush, LiDAR to init.ply), Brush is CLI-binary-only and cannot resume a model, COLMAP-free policy (always feed ARKit-posed dataset) (+14 more)

### Community 63 - "MatrixSerializationTests"
Cohesion: 0.17
Nodes (11): pose(), Float, MatrixSerialization, simd_float4x4, .translation, Double, Float, simd_float3x3 (+3 more)

### Community 64 - "Clock sync"
Cohesion: 0.18
Nodes (8): ClockSyncEstimator, estimate(), NTP-like clock offset / RTT estimation. An exchange: t0_client -- client send…, Sample, exchange(), Clock-sync estimation unit tests: injected offset, jitter, drift, filtering., Build (t0,t1,t2,t3) for a client whose clock is behind server by offset., TestClockSync

### Community 65 - "Gs3d"
Cohesion: 0.12
Nodes (15): Anchor, GS3DStage(), Props, GS3D, GS3D_SOURCE, GS3DControls, GS3DViewer, importFromCDN() (+7 more)

### Community 66 - "DESIGN"
Cohesion: 0.10
Nodes (21): Accessibility contract (WCAG AA both registers), Retired aurora night landing scene (LandingHero + HeroSky + blob button), FIELD NOTES design register, The gallery deck (pinned pile of taped prints), The glass bar (the journal's one pane of glass), Honesty principle (discards shown, synthetic labelled), Lenis resize on ScrollTrigger refresh, Two motion curves: ease-signature and ease-reveal (+13 more)

### Community 67 - "Splat batch"
Cohesion: 0.19
Nodes (20): extract_frames(), _lap_var(), log_line(), main(), process(), CompletedProcess, Path, quality_and_prune() (+12 more)

### Community 68 - "Status"
Cohesion: 0.16
Nodes (14): app(), credentials(), notify(), publishProgress(), PushInput, ProgressFrame, progressPath(), RTDB_RULES (+6 more)

### Community 69 - "Test intrinsics"
Cohesion: 0.21
Nodes (12): FormatError, Raised when a capture file violates the format contract., intrinsic_params(), ndarray, Camera intrinsics scaling for depth unprojection. RGB and LiDAR depth have…, Return (fx, fy, cx, cy) from a 3x3 intrinsics matrix., Scale a 3x3 intrinsics matrix from ``src_size`` to ``dst_size``. ``src_size`` /…, scale_intrinsics() (+4 more)

### Community 70 - "Process video"
Cohesion: 0.19
Nodes (19): analyze_frame(), extract_audio(), _hist_dist(), main(), probe(), process(), CompletedProcess, Path (+11 more)

### Community 71 - "WalkLedger"
Cohesion: 0.14
Nodes (19): Props, GeoRef, PIPELINE_CONFIG, AtlasView, TriggerKind, buildWalkLedger(), companyOf(), LedgerFamily (+11 more)

### Community 72 - "SampleFrames"
Cohesion: 0.14
Nodes (17): Found, Phase, VideoWalkPanel(), Working(), DETECTOR_MODELS, formatBytes(), ProgressInfo, RawDetection (+9 more)

### Community 73 - "LocationOneShot"
Cohesion: 0.23
Nodes (10): CLLocation, CLLocationCoordinate2D, CLLocationManager, CLLocationManagerDelegate, LocationOneShot, OneShotDelegate, Error, String (+2 more)

### Community 74 - "FrameSamplerTests"
Cohesion: 0.21
Nodes (7): FixedRateSampler, Bool, Double, TimeInterval, FrameSamplerTests, Double, Int

### Community 75 - "Formats"
Cohesion: 0.15
Nodes (14): frame_meta_to_dict(), iter_metadata(), JsonlIssue, parse_intrinsics(), parse_session(), Any, Path, Gauzensplat capture format contract — single source of truth. This module… (+6 more)

### Community 76 - "Route"
Cohesion: 0.11
Nodes (7): dynamic, dynamic, dynamic, dynamic, dynamic, dynamic, STUDIO_URL

### Community 77 - "FieldMap"
Cohesion: 0.16
Nodes (13): AtlasApp(), posAt(), Props, FieldMap(), line(), Props, ReliveOverlay(), clockTime() (+5 more)

### Community 78 - "ClockSync"
Cohesion: 0.19
Nodes (11): ClockSample, ClockSyncEstimator, .bestOffsetNs, .bestRttNs, .sampleCount, .usable, Double, Int (+3 more)

### Community 79 - "HeroAssets"
Cohesion: 0.18
Nodes (12): metadata, brighten(), curtainPath(), CURTAINS, HeroSky(), LandingHero(), ScrollCue(), AURORA (+4 more)

### Community 80 - "BlobSprites"
Cohesion: 0.15
Nodes (15): Sequence, BlobMark(), FRAME, Phase, WAKE_EVENTS, BLOB_CELLS, BLOB_CLIPS, BLOB_FRAMES (+7 more)

### Community 81 - "ARFrameExtraction"
Cohesion: 0.21
Nodes (12): ARCamera, CVPixelBuffer, ARFrameExtractor, ExtractedFrame, ARFrame, CGFloat, Data, Double (+4 more)

### Community 82 - "IMPLEMENTATION STATUS"
Cohesion: 0.13
Nodes (17): Checksums, ACKs and idempotent duplicate handling, Clock synchronization requirement (never share an epoch), End-of-session manifest reconciliation, Session negotiation and live_sessions layout, AWAITING_DEVICE_VALIDATION hardware gate, Phase 1 — native iOS ARKit capture app, Phase 2 — offline Mac inspector, Phase 3 — phone/laptop connection, handshake, clock sync (+9 more)

### Community 83 - "README"
Cohesion: 0.15
Nodes (17): Coordinate conventions (row-major matrices, raw ARCamera.transform), GET /api/live_splat endpoint, Unified studio server (:8899, serial GPU job queue), Viewer live mode (double-buffered ply swap), WS /ws/splat_updates push channel, bigview true gaussian renderer, 8765 point-viewer (draws every gaussian center solid), Quality metrics (gaussian count is not quality) (+9 more)

### Community 84 - "Semantics"
Cohesion: 0.27
Nodes (16): _cost(), _gemini(), _jpeg_b64(), _keyframes(), label(), _load_transcript(), main(), _moment_lines() (+8 more)

### Community 85 - "IntrinsicsScalingTests"
Cohesion: 0.24
Nodes (8): IntrinsicsScaling, Params, Double, Int, simd_float3x3, IntrinsicsScalingTests, Float, simd_float3x3

### Community 86 - "README"
Cohesion: 0.16
Nodes (16): BoundedFrameQueue (backpressure drops, bounded RAM), test_long_stream_bounded_memory, Moment segmentation (color-fingerprint scene cuts), Semantic labeling with a VLM (Gemini/GPT/Qwen backends), Sharpness gate (drop blurriest frames), lib/mock/buildTrip.ts and the eight authoring rules, Heading unit trap (radians vs compass degrees), lib/detect/track.ts IoU tracker and minHits (+8 more)

### Community 87 - "007 rls"
Cohesion: 0.14
Nodes (14): public.album_shares, public.friendships, public.group_members, public.journey_shares, public.moment_shares, public.are_friends(), public.can_read_album(), public.can_read_journey() (+6 more)

### Community 88 - "Package"
Cohesion: 0.12
Nodes (15): name, private, scripts, build, build:frames, build:icons, build:sprites, dev (+7 more)

### Community 89 - "AlbumClient"
Cohesion: 0.17
Nodes (10): AlbumCard(), AlbumClient(), AlbumItem, AlbumPlace, CoverPicker(), GeoResult, splatCount(), TrainingStatus() (+2 more)

### Community 90 - "ViewQuality"
Cohesion: 0.19
Nodes (14): CANONICAL_ASPECT, clamp01(), critiqueFor(), logBell(), pickBestView(), rankViews(), ScoredDetection, scoreView() (+6 more)

### Community 91 - "Stackt market"
Cohesion: 0.21
Nodes (13): lngLatToLocal, LEG(), MOMENTS, P(), PLACES, ROUTE, STREET_LIFE, CANOE_TO_COURTYARD (+5 more)

### Community 92 - "Bake routes"
Cohesion: 0.19
Nodes (14): bakeTrip(), buildGraph(), CACHE_DIR, constName(), COST, dijkstra(), fetchWays(), HERE (+6 more)

### Community 93 - "FORMAT SPEC"
Cohesion: 0.20
Nodes (14): Matrix serialization requirement (row-major nested arrays), CoreCheck runnable test mirror (no XCTest needed), Depth unprojection convention, inspect_capture.py offline inspector, tools/arkit_capture Python suite (62 passed), Swift CoreCheck (23 checks, cross-language golden), Confidence binary format (.u8 ARConfidenceLevel), Depth binary format (.f32 little-endian meters) (+6 more)

### Community 94 - "GPS LOCATION CAPTURE HANDOVER"
Cohesion: 0.18
Nodes (14): Absolute phase-gate rule, Distinct capture_format_version and network_protocol_version, Testing principle (tests are part of implementation), begin_session optional latitude/longitude/place_name keys, live_recon.py stamps meta.place on the run, No protocol-version bump for additive optional keys, SessionStore.set_place persistence path, Phase 0 — repo layout, format/protocol contracts, Python readers (+6 more)

### Community 95 - "Aurora wide 2400"
Cohesion: 0.25
Nodes (14): Aurora Tall 1350 — Portrait Hero Backplate (1350w), Aurora Tall 900 — Portrait Hero Backplate (900w), Aurora Wide 1600 — Landscape Hero Backplate (1600w), Aurora Wide 2400 — Landscape Hero Backplate (2400w), Responsive Hero Backplate Ladder (wide/tall x 2 widths), Sprite-Strip Walk Animation (steps() over packed frames), Blob Walk — Six-Frame Mascot Walk-Cycle Sprite Sheet, Keyart A — Aurora Over Pine Lake (+6 more)

### Community 96 - "CaptureFileStore"
Cohesion: 0.26
Nodes (6): FileHandle, CaptureFileStore, Int, String, URL, SessionInfo

### Community 97 - "FileNaming"
Cohesion: 0.35
Nodes (5): FileNaming, Date, Int, String, UUID

### Community 98 - "Test validate"
Cohesion: 0.37
Nodes (3): TestValidation, Path, validate_capture()

### Community 99 - "Studio"
Cohesion: 0.32
Nodes (10): AlbumPage(), dynamic, metadata, bigviewUrl(), fetchRuns(), framesAlbumUrl(), isTraining(), runSpecs() (+2 more)

### Community 100 - "Icon"
Cohesion: 0.21
Nodes (13): Spark App Icon (Favicon), Concept: Spark Glow Brand Mark on Dark Ground, Mock Frame: Build Room Close-Up, Subject: Hacker at Laptop on Blue-Draped Table, Mock Frame: Build Room Overhead, Scene: Hackathon Build Room, Mock Frame: Courtyard Turf Lawn, Mock Frame: Courtyard Meal (+5 more)

### Community 101 - "TripSessionCard"
Cohesion: 0.21
Nodes (9): Counters(), DOT_TONE, EYEBROW_TONE, RING, Tone, TripSessionCard(), RecordControl(), RecordTone (+1 more)

### Community 102 - "ObjectIndex"
Cohesion: 0.24
Nodes (12): nearestPathPoint(), bestTokenSimilarity(), crossRank(), IndexTripRef, levenshtein(), mergeObjectIndexes(), navTargetFor(), normalizeQuery() (+4 more)

### Community 103 - "Build landmask"
Cohesion: 0.15
Nodes (8): b64, cells, GeoJson, HERE, packed, Ring, rings, SOURCE

### Community 104 - "006 splats storage sessions"
Cohesion: 0.24
Nodes (12): public.live_sessions, public.splat_assets, public.splat_jobs, public.splat_jobs_view, public.storage_objects, public.storage_used_bytes(), splat_jobs_touch, public (+4 more)

### Community 105 - "DESIGN"
Cohesion: 0.20
Nodes (12): CloudLayer (world-anchored cumulus over the map), The desk globe (PocketGlobe / GlobeOverlay / paperGlobe), FAMILY_COLOR / FAMILY_COLOR_DEEP two-face label scheme, Generated map style (build-map-style.mjs to field-notes.json), NIGHT WALK register (retired v5.3), NumberChip (typewriter number in hand-drawn pen ring), Specimen banner pins (clock-flying swallow-tailed banners), STACKT flagship route snapped to OSM foot-ways (+4 more)

### Community 106 - "GPS LOCATION CAPTURE HANDOVER"
Cohesion: 0.17
Nodes (12): GPS handover acceptance criteria, Fail-open location policy, LocationOneShot helper (one-shot CoreLocation fix), On-device reverse geocoding with CLGeocoder, meta.place field (name/lat/lng), SessionInfo record extended with location fields, GauzensplatCapture app target, GauzensplatCaptureCore framework target (+4 more)

### Community 107 - "003 journeys and albums"
Cohesion: 0.30
Nodes (11): albums_touch, journeys_touch, public.album_journeys, public.album_shares, public.albums, public.journey_shares, public.journeys, public (+3 more)

### Community 108 - "Splat tools"
Cohesion: 0.31
Nodes (10): inspect(), _load(), main(), prune(), exp(log-scale) per axis, or None if the ply has no scale fields., Per-gaussian keep-score. 'opacity' = raw logit-opacity (legacy). 'contribution'…, Raise each kept gaussian's smallest axis so max/min <= max_ratio. Flat disks…, _round_aniso() (+2 more)

### Community 109 - "Build capture frames"
Cohesion: 0.22
Nodes (10): Box, Cut, CUTS, DESIGN, HERE, main(), OUT, rect() (+2 more)

### Community 110 - "BoundedFrameQueue"
Cohesion: 0.27
Nodes (5): Element, BoundedFrameQueue, .count, Bool, Int

### Community 111 - "ConnectionTester"
Cohesion: 0.22
Nodes (8): ConnectionTester, Result, Bool, Double, Int, String, URL, URLSession

### Community 112 - "005 pipeline"
Cohesion: 0.31
Nodes (9): public.invites, public.detection_bins, public.moment_candidates, public.moment_shares, public.moments, public.object_sightings, public.groups, public.journeys (+1 more)

### Community 113 - "Test formats"
Cohesion: 0.44
Nodes (3): parse_frame_meta(), Parse one metadata record. Requires mandatory fields, ignores unknown optional…, TestMetadataParsing

### Community 114 - "LiveTripProvider"
Cohesion: 0.38
Nodes (7): LiveTrip, LiveTripContext, LiveTripProvider(), ActiveTripSnapshot, StartTripInput, useActiveTrip, useNowSeconds()

### Community 115 - "001 extensions and identity"
Cohesion: 0.22
Nodes (6): auth.users, public.handle_new_user, on_auth_user_created, profiles_touch, public.profiles, public.touch_updated_at

### Community 116 - "002 social"
Cohesion: 0.31
Nodes (6): public.seed_group_owner, groups_seed_owner, public.friendships, public.group_members, public.groups, public.profiles

### Community 117 - "CloudLayer"
Cohesion: 0.39
Nodes (8): blurred(), Cloud, CloudLayer(), makeSprites(), mulberry32(), paintCloud(), SHADOW_OFFSET_M, smoothstep()

### Community 119 - "Sky mask"
Cohesion: 0.43
Nodes (7): main(), make_mask(), ndarray, Path, Boolean sky mask (True = sky) for an HxWx3 float image in [0,1]., sky_probability(), write_colmap_masks()

### Community 120 - "Layout"
Cohesion: 0.29
Nodes (5): grotesk, metadata, poppins, typewriter, DeviceFrame()

### Community 121 - "Build icons"
Cohesion: 0.36
Nodes (7): APP, firefly(), HERE, ico(), main(), render(), ROOT

### Community 122 - "004 invites"
Cohesion: 0.36
Nodes (7): public.invite_redemptions, public.invites, public.redeem_invite(), public.albums, public.groups, public.journeys, public.profiles

### Community 123 - "CaptureFormat"
Cohesion: 0.29
Nodes (6): CaptureFormat, ConfidenceLevel, high, low, medium, UInt8

### Community 124 - "Temporal splat phase0"
Cohesion: 0.48
Nodes (6): main(), nn_correspondence(), peak_mb(), For each row in A, index of nearest row in B (Euclidean on xyz). Chunked., read_ply(), xyz()

### Community 125 - "Page"
Cohesion: 0.38
Nodes (4): dynamic, metadata, MapScreen(), locatedPins()

### Community 126 - "Keyframe"
Cohesion: 0.38
Nodes (5): Keyframe(), Props, paletteFor(), placeholderDataUri(), Keyframe

### Community 127 - "Build map style"
Cohesion: 0.29
Nodes (5): base, dest, FIELD_NOTES, here, NIGHT_WALK

### Community 128 - "Phone brush"
Cohesion: 0.50
Nodes (4): KMP_DUPLICATE_LIB_OK, OMP_NUM_THREADS, run(), phone_brush.sh script

### Community 129 - "Phone brush2"
Cohesion: 0.50
Nodes (4): KMP_DUPLICATE_LIB_OK, OMP_NUM_THREADS, run(), phone_brush2.sh script

### Community 130 - "Splat progress"
Cohesion: 0.70
Nodes (4): main(), show(), snapshots(), vertex_count()

### Community 131 - "Route"
Cohesion: 0.50
Nodes (4): dynamic, GET(), NO_STORE, serverStartedAt()

### Community 133 - "Run live studio"
Cohesion: 0.50
Nodes (3): LIVE_RECON, run_live_studio.sh script, STUDIO_PORT

### Community 134 - "Analytics"
Cohesion: 0.83
Nodes (3): cell(), flatten(), main()

### Community 135 - "Build compare specs"
Cohesion: 0.67
Nodes (3): main(), # NOTE: every run is auto-pruned (result_clean.ply) + quality-checked by, variants_for()

### Community 136 - "Phone ultra"
Cohesion: 0.50
Nodes (3): KMP_DUPLICATE_LIB_OK, OMP_NUM_THREADS, phone_ultra.sh script

### Community 138 - "Copy maplibre worker"
Cohesion: 0.50
Nodes (3): dest, dist, here

### Community 140 - "AGENTS"
Cohesion: 0.67
Nodes (3): Next.js agent rules block (read node_modules docs first), web/CLAUDE.md include of AGENTS.md, proxy.ts replaces middleware in Next 16

## Ambiguous Edges - Review These
- `Path 1.5 progressive reconstruction (v1)` → `Non-goals list (no web app, no Brush, no cloud, no auth)`  [AMBIGUOUS]
  gauzensplat_master_iphone_wifi_esp32_implementation_prompt.md · relation: conceptually_related_to
- `Blob Companion Character (Spark mascot)` → `In-Scene Chat Bubbles ("What's up?" / "Do you sleep?")`  [AMBIGUOUS]
  design/landing-page-3.jpg · relation: conceptually_related_to
- `"Where's my..." Command Palette (Cmd+K) Search` → `In-Scene Voice/Prompt Chips ("What's up?", "Do you sleep?")`  [AMBIGUOUS]
  devpost2.png · relation: semantically_similar_to
- `Keyart Hero — Lamplight Lakeside Path` → `Keyart A — Aurora Over Pine Lake`  [AMBIGUOUS]
  web/public/hero/keyart-hero.webp · relation: conceptually_related_to

## Knowledge Gaps
- **591 isolated node(s):** `.health`, `.stats`, `.lastSessionURL`, `.capturesDir`, `.sessionsIndexURL` (+586 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Path 1.5 progressive reconstruction (v1)` and `Non-goals list (no web app, no Brush, no cloud, no auth)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Blob Companion Character (Spark mascot)` and `In-Scene Chat Bubbles ("What's up?" / "Do you sleep?")`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `"Where's my..." Command Palette (Cmd+K) Search` and `In-Scene Voice/Prompt Chips ("What's up?", "Do you sleep?")`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Keyart Hero — Lamplight Lakeside Path` and `Keyart A — Aurora Over Pine Lake`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `CaptureViewModel` connect `iOS Capture View Model` to `LocationOneShot`, `CaptureTransport`, `iOS Capture Coordinator`, `Wi-Fi Mirroring Transport`, `ARSessionController`, `DebugView`, `Apple Framework Imports`, `ExportSheet`, `iOS Capture UI`, `CaptureView`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CaptureCoordinator` connect `iOS Capture Coordinator` to `CaptureFileStore`, `AudioCapture`, `iOS Capture View Model`, `BoundedFrameQueue`, `CaptureTransport`, `Capture Frame Persistence`, `Wi-Fi Mirroring Transport`, `Apple Framework Imports`, `Capture State Machine`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CodingKeys` connect `iOS Capture Record Schema` to `Capture Frame Persistence`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._