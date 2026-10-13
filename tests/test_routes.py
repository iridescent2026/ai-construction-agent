"""迁移旧版闭合路线和风险偏好测试，使用新版根目录服务。"""
import json
import unittest
from itertools import permutations
from fastapi.testclient import TestClient
from agent_support import agent as module


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(module.app)
        self.points = [
            {"id": "S", "lng": 120.008, "lat": 30.293, "risk": 0},
            {"id": "L", "lng": 120.007, "lat": 30.293, "risk": 0.1},
            {"id": "H", "lng": 120.010, "lat": 30.293, "risk": 0.9},
        ]

    def route(self, points, start="S", **options):
        options.setdefault("risk_priority_weight", 5)
        response = self.client.post("/route", json={"points": points, "start_id": start, **options})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def route_distance(self, route, points):
        by_id = {p["id"]: module.Point(**p) for p in points}
        return sum(int(module.distance(by_id[a], by_id[b])) for a, b in zip(route, route[1:]))

    def test_higher_risk_changes_visit_order(self):
        result = self.route(self.points)
        self.assertEqual(result["route"], ["S", "H", "L", "S"])
        # 坐标不变，只交换风险，路线应随之改变。
        self.points[1]["risk"], self.points[2]["risk"] = 0.9, 0.1
        swapped = self.route(self.points)
        self.assertEqual(swapped["route"], ["S", "L", "H", "S"])

    def test_reported_objective_matches_solver_and_waiting_metric(self):
        result = self.route(self.points)
        weighted = sum(round(stop["risk"] * 100) * stop["arrival_distance"] for stop in result["stops"][1:-1]) / 100
        self.assertEqual(result["risk_priority_weight"], 5)
        self.assertEqual(result["risk_weighted_arrival_distance"], weighted)
        self.assertAlmostEqual(result["optimization_score"], result["total_distance"] + 5 * weighted)

    def test_zero_weight_optimizes_distance_only(self):
        points = [*self.points, {"id":"N", "lng":120.008, "lat":30.294, "risk":1}]
        result = self.route(points, risk_priority_weight=0)
        optimum = min(self.route_distance(["S", *order, "S"], points) for order in permutations(["L","H","N"]))
        self.assertEqual(result["total_distance"], optimum)
        self.assertEqual(result["optimization_score"], optimum)
        self.assertIn("点间距离", result["reason"])

    def test_invalid_priority_weight_is_rejected(self):
        for weight in (-1, 21, 0.5, True, "5"):
            with self.subTest(weight=weight):
                response = self.client.post("/route", json={"points":self.points, "start_id":"S", "risk_priority_weight":weight})
                self.assertEqual(response.status_code, 422)

    def test_existing_default_remains_distance_only(self):
        response=self.client.post('/route',json={'points':self.points,'start_id':'S'})
        self.assertEqual(response.status_code,200,response.text)
        result=response.json()
        self.assertEqual(result['risk_priority_weight'],0)
        self.assertEqual(result['optimization_score'],result['total_distance'])
        self.assertEqual(result['solver'],'OR-Tools')
        self.assertFalse(result['walkability_verified'])

    def test_remote_point_limit_is_preserved(self):
        points=[{**self.points[0],'id':str(index)} for index in range(101)]
        response=self.client.post('/route',json={'points':points,'start_id':'0'})
        self.assertEqual(response.status_code,422)

    def test_closed_route_distance_with_nonzero_start(self):
        result = self.route(self.points, start="H")
        self.assertEqual(result["route"][0], "H")
        self.assertEqual(result["route"][-1], "H")
        self.assertCountEqual(result["route"][:-1], ["S", "L", "H"])
        expected = self.route_distance(result["route"], self.points)
        self.assertEqual(result["total_distance"], expected)
        self.assertEqual(result["estimated_time"], round(expected / 60, 1))

    def test_missing_risk_uses_distance_only(self):
        points = [{k: v for k, v in p.items() if k != "risk"} for p in self.points]
        points.append({"id": "N", "lng": 120.008, "lat": 30.294})
        result = self.route(points)
        optimum = min(
            self.route_distance(["S", *order, "S"], points)
            for order in permutations(["L", "H", "N"])
        )
        self.assertEqual(result["total_distance"], optimum)
        self.assertIn("点间距离", result["reason"])

    def test_coincident_points(self):
        points = [self.points[0], {**self.points[0], "id": "H", "risk": 0.9}]
        result = self.route(points)
        self.assertEqual(result["route"], ["S", "H", "S"])
        self.assertEqual(result["total_distance"], 0)
        self.assertTrue(all(stop["arrival_distance"] == 0 and stop["arrival_time"] == 0 for stop in result["stops"]))

    def test_arrival_details_include_return_and_match_closed_tour(self):
        result = self.route(self.points)
        self.assertEqual([stop["id"] for stop in result["stops"]], ["S", "H", "L", "S"])
        stops = result["stops"]
        self.assertEqual(stops[0]["leg_distance"], 0)
        self.assertEqual(stops[0]["arrival_time"], 0)
        self.assertEqual(stops[1]["risk"], 0.9)
        # H 位于起点以东约 192 米，不应被误算成 H 到 L 的距离。
        self.assertAlmostEqual(stops[1]["arrival_distance"], 192, delta=2)
        self.assertAlmostEqual(stops[1]["arrival_time"], 3.2, delta=0.1)
        self.assertGreater(stops[-1]["arrival_distance"], stops[-2]["arrival_distance"])
        self.assertEqual(sum(stop["leg_distance"] for stop in stops), result["total_distance"])
        self.assertEqual(stops[-1]["arrival_distance"], result["total_distance"])
        self.assertEqual(stops[-1]["arrival_time"], result["estimated_time"])

    def test_arrival_details_follow_selected_start(self):
        result = self.route(self.points, start="H")
        stops = result["stops"]
        self.assertEqual(stops[0]["id"], "H")
        self.assertEqual(stops[0]["arrival_distance"], 0)
        self.assertEqual(stops[-1]["id"], "H")
        for index, stop in enumerate(stops):
            self.assertEqual(stop["arrival_distance"], self.route_distance(result["route"][:index + 1], self.points))
            self.assertEqual(stop["arrival_time"], round(stop["arrival_distance"] / 60, 1))

    def test_out_of_range_risk_is_rejected(self):
        for risk in (-0.1, 1.1):
            with self.subTest(risk=risk):
                points = [self.points[0], {**self.points[1], "risk": risk}]
                response = self.client.post("/route", json={"points": points, "start_id": "S"})
                self.assertEqual(response.status_code, 422)

    def test_missing_start_is_rejected(self):
        response = self.client.post("/route", json={"points": self.points, "start_id": "UNKNOWN"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("起点", str(response.json()["detail"]))

    def test_invalid_coordinates_are_rejected(self):
        for field, values in (("lng", [-180.01, 180.01, "NaN", "Infinity"]),
                              ("lat", [-90.01, 90.01, "NaN", "-Infinity"])):
            for value in values:
                with self.subTest(field=field, value=value):
                    points = [self.points[0], {**self.points[1], field: value}]
                    response = self.client.post("/route", json={"points": points, "start_id": "S"})
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.json()["detail"][0]["loc"], ["body", "points", 1, field])

    def test_empty_point_ids_are_rejected(self):
        for point_id in ("", "   "):
            with self.subTest(id=point_id):
                points = [self.points[0], {**self.points[1], "id": point_id}]
                response = self.client.post("/route", json={"points": points, "start_id": "S"})
                self.assertEqual(response.status_code, 422)

    def test_nonstandard_nonfinite_json_does_not_break_error_response(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                points = [self.points[0], {**self.points[1], "lng": value}]
                response = self.client.post("/route", content=json.dumps({"points": points, "start_id": "S"}),
                                            headers={"Content-Type": "application/json"})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["detail"][0]["loc"], ["body", "points", 1, "lng"])

    def test_antipodal_points_have_finite_distance(self):
        # 经纬度边界有效；对跖点不会因浮点误差触发 sqrt 定义域异常。
        points = [{"id":"S", "lng":0, "lat":0}, {"id":"N", "lng":180, "lat":0}]
        result = self.route(points)
        self.assertAlmostEqual(result["total_distance"], 40030172, delta=2)
        self.assertEqual(result["route"], ["S", "N", "S"])

    def test_duplicate_point_ids_are_rejected(self):
        for duplicate_id in ("S", "L"):
            with self.subTest(duplicate_id=duplicate_id):
                points = [*self.points, {**self.points[2], "id": duplicate_id}]
                response = self.client.post("/route", json={"points": points, "start_id": "S"})
                self.assertEqual(response.status_code, 422)
                self.assertIn("巡检点编号不能重复", str(response.json()["detail"]))

    def test_too_few_points_are_rejected(self):
        for points in ([], self.points[:1]):
            with self.subTest(count=len(points)):
                response = self.client.post("/route", json={"points": points, "start_id": "S"})
                self.assertEqual(response.status_code, 422)
                self.assertTrue(response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
