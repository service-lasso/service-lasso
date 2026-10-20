import { workerData } from "node:worker_threads";

// Docusaurus reads these exact Tinypool worker-state and workerData surfaces.
export default function renderTask(task) {
  return {
    pathnames: task.pathnames,
    title: workerData[1].params.title,
    workerId: process.__tinypool_state__.workerId,
    isWorkerThread: process.__tinypool_state__.isWorkerThread,
  };
}
